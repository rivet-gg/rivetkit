import { actor } from "@rivetkit/actor";

export type Contact = {
	id: string;
	name: string;
	email: string;
	phone: string;
	updatedAt: number;
};

const contacts = actor({
	// State is automatically persisted
	state: {
		contacts: {},
	},

	actions: {
		// Gets changes after the last timestamp (when coming back online)
		getChanges: (c, after = 0) => {
			const changes = Object.values(c.state.contacts).filter(
				(contact) => contact.updatedAt > after,
			);

			return {
				changes,
				timestamp: Date.now(),
			};
		},

		// Pushes new changes from the client & handles conflicts
		pushChanges: (c, contacts: Contact[]) => {
			let changed = false;

			contacts.forEach((contact) => {
				const existing = c.state.contacts[contact.id];

				if (!existing || existing.updatedAt < contact.updatedAt) {
					c.state.contacts[contact.id] = contact;
					changed = true;
				}
			});

			if (changed) {
				c.broadcast("contactsChanged", {
					contacts: Object.values(c.state.contacts),
				});
			}

			return { timestamp: Date.now() };
		},
	},
});

export default contacts;
