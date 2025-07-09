import { actor, setup } from "@rivetkit/actor";
import { UserError } from "@rivetkit/actor/errors";

export type Member = {
	id: string;
	name: string;
	email: string;
	role: "admin" | "member";
};

export type Invoice = {
	id: string;
	amount: number;
	date: number;
	paid: boolean;
	description: string;
};

export type ConnState = {
	userId: string;
	role: "admin" | "member";
};

// Simple authentication function
async function authenticate(
	token: string,
): Promise<{ userId: string; role: "admin" | "member" }> {
	// Simple token parsing - in production, verify JWT or session
	if (token.startsWith("auth:")) {
		const userId = token.split(":")[1];

		// Hardcoded user roles for demo
		const userRoles: Record<string, "admin" | "member"> = {
			"user-1": "admin", // Alice
			"user-2": "member", // Bob
			"user-3": "member", // Charlie
		};

		const role = userRoles[userId];
		if (!role) {
			throw new UserError("Invalid authentication token");
		}

		return { userId, role };
	}

	throw new UserError("Invalid authentication token format");
}

const tenant = actor({
	onAuth: () => {},
	// Persistent state that survives restarts: https://rivet.gg/docs/actors/state
	state: {
		orgId: "org-1",
		orgName: "Acme Corporation",
		members: [
			{
				id: "user-1",
				name: "Alice Johnson",
				email: "alice@acme.com",
				role: "admin" as const,
			},
			{
				id: "user-2",
				name: "Bob Smith",
				email: "bob@acme.com",
				role: "member" as const,
			},
			{
				id: "user-3",
				name: "Charlie Brown",
				email: "charlie@acme.com",
				role: "member" as const,
			},
		],
		invoices: [
			{
				id: "inv-001",
				amount: 1200.0,
				date: Date.now() - 86400000 * 30, // 30 days ago
				paid: true,
				description: "Monthly subscription - Enterprise plan",
			},
			{
				id: "inv-002",
				amount: 1200.0,
				date: Date.now() - 86400000 * 7, // 7 days ago
				paid: false,
				description: "Monthly subscription - Enterprise plan",
			},
			{
				id: "inv-003",
				amount: 250.0,
				date: Date.now() - 86400000 * 3, // 3 days ago
				paid: true,
				description: "Additional storage - 500GB",
			},
		],
	},

	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		getOrganization: (c) => {
			return {
				id: c.state.orgId,
				name: c.state.orgName,
				memberCount: c.state.members.length,
			};
		},

		getMembers: (c) => {
			return c.state.members;
		},

		getDashboardStats: (c) => {
			const stats = {
				totalMembers: c.state.members.length,
				adminCount: c.state.members.filter((m) => m.role === "admin").length,
				memberCount: c.state.members.filter((m) => m.role === "member").length,
			};

			// For testing, always return basic stats
			return stats;
		},
	},
});

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { tenant },
});
