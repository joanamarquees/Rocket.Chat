import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { isEditedMessage } from '@rocket.chat/core-typings';
import { Messages } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { callbacks } from '../../../../lib/callbacks';
import { broadcastMessageFromData } from '../../../../server/modules/watchers/lib/messages';
import { updateThreadUsersSubscriptions, getMentions } from '../../../lib/server/lib/notifyUsersOnMessage';
import { sendMessageNotifications } from '../../../lib/server/lib/sendNotificationsOnMessage';
import { settings } from '../../../settings/server';
import { reply } from '../functions';

async function notifyUsersOnReply(message: IMessage, replies: string[], room: IRoom) {
	// skips this callback if the message was edited
	if (isEditedMessage(message)) {
		return message;
	}

	await updateThreadUsersSubscriptions(message, room, replies);

	return message;
}

async function metaData(message: IMessage, parentMessage: IMessage, followers: string[]) {
	await reply({ tmid: message.tmid }, message, parentMessage, followers);

	return message;
}

const notification = async (message: IMessage, room: IRoom, replies: string[]) => {
	// skips this callback if the message was edited
	if (isEditedMessage(message)) {
		return message;
	}

	// will send a notification to everyone who replied/followed the thread except the owner of the message
	await sendMessageNotifications(message, room, replies);

	return message;
};

export async function processThreads(message: IMessage, room: IRoom) {
	if (!message.tmid) {
		return message;
	}

	const parentMessage = await Messages.findOneById(message.tmid);
	if (!parentMessage) {
		return message;
	}

	const { mentionsIds } = await getMentions(message);

	const replies = [
		...new Set([
			...((!parentMessage.tcount ? [parentMessage.u._id] : parentMessage.replies) || []),
			...(!parentMessage.tcount && room.t === 'd' && room.uids ? room.uids : []),
			...mentionsIds,
		]),
	].filter((userId) => userId !== message.u._id);

	await notifyUsersOnReply(message, replies, room);
	await metaData(message, parentMessage, replies);
	await notification(message, room, replies);
	void broadcastMessageFromData({
		id: message.tmid,
	});

	return message;
}

Meteor.startup(() => {
	settings.watch<boolean>('Threads_enabled', (value) => {
		if (!value) {
			callbacks.remove('afterSaveMessage', 'threads-after-save-message');
			return;
		}
		callbacks.add(
			'afterSaveMessage',
			async (message, room) => {
				return processThreads(message, room);
			},
			callbacks.priority.LOW,
			'threads-after-save-message',
		);
	});
});
