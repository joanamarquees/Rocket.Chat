import type { ILivechatVisitor, ILivechatVisitorDTO, Serialized } from '@rocket.chat/core-typings';
import type { ComponentChildren } from 'preact';
import { Component, createContext } from 'preact';

import type { CustomField } from '../components/Form/CustomFields';
import type { Agent } from '../definitions/agents';
import type { Department } from '../definitions/departments';
import { parentCall } from '../lib/parentCall';
import { createToken } from '../lib/random';
import Store from './Store';

export type LivechatHiddenSytemMessageType =
	| 'uj' // User joined
	| 'ul' // User left
	| 'livechat-close' // Chat closed
	| 'livechat-started' // Chat started
	| 'livechat_transfer_history' // Chat transfered
	| 'livechat_webrtc_video_call'; // Video call

export type StoreState = {
	token: string;
	typing: string[];
	config: {
		messages: any;
		theme: {
			title?: string;
			color?: string;
			offlineTitle?: string;
			offlineColor?: string;
			actionLinks?: {
				webrtc: {
					actionLinksAlignment: string;
					i18nLabel: string;
					label: string;
					method_id: string;
				}[];
				jitsi: {
					icon: string;
					i18nLabel: string;
				}[];
			};
		};
		triggers: any[];
		resources: any;
		settings: {
			registrationForm?: boolean;
			nameFieldRegistrationForm?: boolean;
			emailFieldRegistrationForm?: boolean;
			forceAcceptDataProcessingConsent?: boolean;
			fileUpload?: any;
			allowSwitchingDepartments?: any;
			showConnecting?: any;
			limitTextLength?: any;
			displayOfflineForm?: boolean;
			hiddenSystemMessages?: LivechatHiddenSytemMessageType[];
		};
		online?: boolean;
		departments: Department[];
		customFields?: CustomField[];
		enabled?: boolean;
	};
	messages: any[];
	user?: Serialized<ILivechatVisitor>;
	guest?: Serialized<ILivechatVisitorDTO>;
	sound: {
		src?: string;
		play?: boolean;
		enabled: boolean;
	};
	iframe: {
		guest?: Serialized<ILivechatVisitorDTO>;
		theme: {
			title?: string;
			color?: string;
			fontColor?: string;
			iconColor?: string;
			offlineTitle?: string;
		};
		visible?: boolean;
		department?: string;
		language?: string;
		hiddenSystemMessages?: LivechatHiddenSytemMessageType[];
	};
	gdpr: {
		accepted: boolean;
	};
	alerts: any[];
	visible: boolean;
	minimized: boolean;
	unread: any;
	incomingCallAlert: any;
	ongoingCall: any;
	businessUnit: any;
	openSessionIds?: string[];
	triggered?: boolean;
	undocked?: boolean;
	expanded?: boolean;
	modal?: any;
	agent?: any;
	room?: any;
	noMoreMessages?: boolean;
	loading?: boolean;
	department?: string;
	lastReadMessageId?: any;
	triggerAgent?: any;
	queueInfo?: any;
	defaultAgent?: Agent;
	parentUrl?: string;
	connecting?: boolean;
	messageListPosition?: 'top' | 'bottom' | 'free';
};

export const initialState = (): StoreState => ({
	token: createToken(),
	typing: [],
	config: {
		messages: {},
		settings: {},
		theme: {},
		triggers: [],
		departments: [],
		resources: {},
	},
	messages: [],
	user: undefined,
	sound: {
		src: '',
		enabled: true,
		play: false,
	},
	iframe: {
		guest: undefined,
		theme: {},
		visible: true,
	},
	gdpr: {
		accepted: false,
	},
	alerts: [],
	visible: true,
	minimized: true,
	unread: null,
	incomingCallAlert: null,
	ongoingCall: null, // TODO: store call info like url, startTime, timeout, etc here
	businessUnit: null,
});

const dontPersist = [
	'messages',
	'typing',
	'loading',
	'alerts',
	'unread',
	'noMoreMessages',
	'modal',
	'incomingCallAlert',
	'ongoingCall',
	'parentUrl',
];

export const store = new Store(initialState(), { dontPersist });

const { sessionStorage } = window;

window.addEventListener('load', () => {
	const sessionId = createToken();
	sessionStorage.setItem('sessionId', sessionId);
	const { openSessionIds = [] } = store.state;
	store.setState({ openSessionIds: [sessionId, ...openSessionIds] });
});

window.addEventListener('visibilitychange', () => {
	!store.state.minimized && !store.state.triggered && parentCall('openWidget');
	store.state.iframe.visible ? parentCall('showWidget') : parentCall('hideWidget');
});

window.addEventListener('beforeunload', () => {
	const sessionId = sessionStorage.getItem('sessionId');
	const { openSessionIds = [] } = store.state;
	store.setState({ openSessionIds: openSessionIds.filter((session) => session !== sessionId) });
});

if (process.env.NODE_ENV === 'development') {
	store.on('change', ([, , partialState]) => {
		console.log('%cstore.setState %c%o', 'color: blue', 'color: initial', partialState);
	});
}

export type Dispatch = typeof store.setState;

type StoreContextValue = StoreState & {
	dispatch: Dispatch;
	on: typeof store.on;
	off: typeof store.off;
};

export const StoreContext = createContext<StoreContextValue>({
	...store.state,
	dispatch: store.setState.bind(store),
	on: store.on.bind(store),
	off: store.off.bind(store),
});

export class Provider extends Component {
	static displayName = 'StoreProvider';

	state = {
		...store.state,
		dispatch: store.setState.bind(store),
		on: store.on.bind(store),
		off: store.off.bind(store),
	};

	handleStoreChange = () => {
		this.setState({ ...store.state });
	};

	componentDidMount() {
		store.on('change', this.handleStoreChange);
	}

	componentWillUnmount() {
		store.off('change', this.handleStoreChange);
	}

	render = ({ children }: { children: ComponentChildren }) => {
		return <StoreContext.Provider value={this.state}>{children}</StoreContext.Provider>;
	};
}

export const { Consumer } = StoreContext;

export default store;
