// import { actor, setup } from "@rivetkit/actor";
// import { auth, type Session, type User } from "./auth";
//
// export const chatRoom = actor({
// 	onAuth: async (c) => {
// 		const authResult = await auth.api.getSession({
// 			headers: c.req.headers,
// 		});
//
// 		if (!authResult?.session || !authResult?.user) {
// 			throw new Error("Unauthorized");
// 		}
//
// 		return {
// 			userId: authResult.user.id,
// 			user: authResult.user,
// 			session: authResult.session,
// 		};
// 	},
// 	state: { 
// 		messages: [] as Array<{ id: string; userId: string; username: string; message: string; timestamp: number }> 
// 	},
// 	actions: {
// 		sendMessage: (c, message: string) => {
// 			const newMessage = {
// 				id: crypto.randomUUID(),
// 				userId: c.auth.userId,
// 				username: c.auth.user.email,
// 				message,
// 				timestamp: Date.now(),
// 			};
//
// 			c.state.messages.push(newMessage);
// 			c.broadcast("newMessage", newMessage);
//
// 			return newMessage;
// 		},
// 		getMessages: (c) => {
// 			return c.state.messages;
// 		},
// 	},
// });
//
// export const registry = setup({
// 	use: { chatRoom },
// });
//
// export type Registry = typeof registry;
