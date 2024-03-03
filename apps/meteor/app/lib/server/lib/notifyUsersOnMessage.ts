import moment from 'moment';

import { IMessage, IRoom, RoomType } from '@rocket.chat/core-typings';
import { Subscriptions, Rooms } from '@rocket.chat/models';
import { escapeRegExp } from '@rocket.chat/string-helpers';
import { api, BroadcastEvents, dbWatchersDisabled } from '@rocket.chat/core-services';

import { callbacks } from '../../../../lib/callbacks';
import { settings } from '../../../settings/server';

function messageContainsHighlight(message: IMessage, highlights: string[]): boolean {
	if (!highlights || highlights.length === 0) return false;

	return highlights.some((highlight: string) => {
		const regexp = new RegExp(escapeRegExp(highlight), 'i');
		return regexp.test(message.msg);
	});
}

export async function getMentions(message: IMessage): Promise<{ toAll: boolean; toHere: boolean; mentionsIds: string[] }> {
	const {
		mentions,
		u: { _id: senderId },
	} = message;

	if (!mentions) {
		return {
			toAll: false,
			toHere: false,
			mentionsIds: [],
		};
	}

	const toAll = mentions.some(({ _id }) => _id === 'all');
	const toHere = mentions.some(({ _id }) => _id === 'here');

	let teamsMentions = [] as any[];
	const filteredMentions = mentions
		.filter((mention) => {
			if (mention.type === 'team') { teamsMentions.push(mention); }
			return !mention.type || mention.type === 'user';
		})
		.filter(({ _id }) => _id !== senderId && !['all', 'here'].includes(_id))
		.map(({ _id }) => _id);

	let mentionsIds = filteredMentions;
	if (teamsMentions.length > 0) {
		mentionsIds = await callbacks.run('beforeGetTeamMentions', filteredMentions, teamsMentions);
	}

	return {
		toAll,
		toHere,
		mentionsIds,
	};
}

const incGroupMentions = async (rid: string, roomType: RoomType, excludeUserId: string, unreadCount: string): Promise<void> => {
	const incUnreadByGroup = ['all_messages', 'group_mentions_only', 'user_and_group_mentions_only'].includes(unreadCount);
	const incUnread = roomType === 'd' || roomType === 'l' || incUnreadByGroup ? 1 : 0;
	await Subscriptions.incGroupMentionsAndUnreadForRoomIdExcludingUserId(rid, excludeUserId, 1, incUnread);
};

const incUserMentions = async (rid: string, roomType: RoomType, uids: string[], unreadCount: string): Promise<void> => {
	const incUnreadByUser = ['all_messages', 'user_mentions_only', 'user_and_group_mentions_only'].includes(unreadCount);
	const incUnread = roomType === 'd' || roomType === 'l' || incUnreadByUser ? 1 : 0;
	await Subscriptions.incUserMentionsAndUnreadForRoomIdAndUserIds(rid, uids, 1, incUnread);
};

export const getUserIdsFromHighlights = async (rid: string, message: IMessage): Promise<string[]> => {
	const highlightOptions = { projection: { 'userHighlights': 1, 'u._id': 1 } };
	const subs = await Subscriptions.findByRoomWithUserHighlights(rid, highlightOptions).toArray();

	return subs
		.filter(({ userHighlights, u: { _id: uid } }) => userHighlights && messageContainsHighlight(message, userHighlights) && uid !== message.u._id)
		.map(({ u: { _id: uid } }) => uid);
};

const getUnreadSettingCount = (roomType: RoomType): string => {
	let unreadSetting = 'Unread_Count';
	if (roomType === 'd') {
		unreadSetting = 'Unread_Count_DM';
	} else if (roomType === 'l') {
		unreadSetting = 'Unread_Count_Omni';
	}

	return settings.get(unreadSetting);
};


async function updateUsersSubscriptions(message: IMessage, room: IRoom): Promise<void> {
	const { toAll, toHere, mentionsIds } = await getMentions(message);

	// Update unread counters only if it is outside of a thread
	// TODO: Check this behavior... is it correct?
	if (room != null && !message.tmid) {
		const usersIds = new Set(mentionsIds);

		const unreadCount = getUnreadSettingCount(room.t);

		(await getUserIdsFromHighlights(room._id, message)).forEach((uid) => usersIds.add(uid));

		if (usersIds.size > 0) {
			await incUserMentions(room._id, room.t, [...usersIds], unreadCount);
		} else if (toAll || toHere) {
			await incGroupMentions(room._id, room.t, message.u._id, unreadCount);
		}

		// This shouldn't run only if has group mentions because it will already exclude mentioned users from the query
		if (!toAll && !toHere && unreadCount === 'all_messages') {
			await Subscriptions.incUnreadForRoomIdExcludingUserIds(room._id, [...usersIds, message.u._id], 1);
		}
	}

	// Run broadcast for mentioned users
	// TODO: Should broadcast when inside of a thread?
	if (dbWatchersDisabled) {
		await api.broadcast(BroadcastEvents.USER_MENTIONS, {
			message,
			mentions: { toAll, toHere, mentionsIds }
		});
	}

	// Update all other subscriptions to alert their owners but without incrementing
	// the unread counter, as it is only for mentions and direct messages
	// We now set alert and open properties in two separate update commands. This proved to be more efficient on MongoDB - because it uses a more efficient index.
	await Promise.all([
		Subscriptions.setAlertForRoomIdExcludingUserId(message.rid, message.u._id),
		Subscriptions.setOpenForRoomIdExcludingUserId(message.rid, message.u._id),
	]);
}

export async function updateThreadUsersSubscriptions(message: IMessage, room: IRoom, replies: string[]): Promise<void> {
	// const unreadCount = settings.get('Unread_Count');
	// incUserMentions(room._id, room.t, replies, unreadCount);

	await Subscriptions.setAlertForRoomIdAndUserIds(message.rid, replies);

	const repliesPlusSender = [...new Set([message.u._id, ...replies])];

	await Subscriptions.setOpenForRoomIdAndUserIds(message.rid, repliesPlusSender);

	// TODO: Fix this cause is waiting for a single string and it should (?!) be an array
	await Subscriptions.setLastReplyForRoomIdAndUserIds(message.rid, repliesPlusSender as unknown as string, new Date());
}

export async function notifyUsersOnMessage(message: IMessage & { editedAt?: Date | undefined }, room: IRoom): Promise<IMessage> {
	// skips this callback if the message was edited and increments it if the edit was way in the past (aka imported)
	if (message.editedAt) {
		if (Math.abs(moment(message.editedAt).diff(Date.now())) > 60000) {
			// TODO: Review as I am not sure how else to get around this as the incrementing of the msgs count shouldn't be in this callback
			await Rooms.incMsgCountById(message.rid, 1);
			return message;
		}

		// only updates last message if it was edited (skip rest of callback)
		if (
			settings.get('Store_Last_Message') &&
			(!message.tmid || message.tshow) &&
			(!room.lastMessage || room.lastMessage._id === message._id)
		) {
			await Rooms.setLastMessageById(message.rid, message);
		}

		return message;
	}

	if (message.ts && Math.abs(moment(message.ts).diff(Date.now())) > 60000) {
		await Rooms.incMsgCountById(message.rid, 1);
		return message;
	}

	// if message sent ONLY on a thread, skips the rest as it is done on a callback specific to threads
	if (message.tmid && !message.tshow) {
		await Rooms.incMsgCountById(message.rid, 1);
		return message;
	}

	// Update all the room activity tracker fields
	await Rooms.incMsgCountAndSetLastMessageById(message.rid, 1, message.ts, settings.get('Store_Last_Message') ? (message as IMessage) : undefined);
	await updateUsersSubscriptions(message, room);

	return message;
}

callbacks.add(
	'afterSaveMessage',
	(message, room) => notifyUsersOnMessage(message, room),
	callbacks.priority.MEDIUM,
	'notifyUsersOnMessage',
);
