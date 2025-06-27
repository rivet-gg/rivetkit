import { betterAuth } from "better-auth";

export const auth = betterAuth({
	// IMPORTANT: Connect a real database for productoin use cases
	//
	// https://www.better-auth.com/docs/installation#create-database-tables
	// database: memoryAdapter({
	// 	user: [],
	// 	account: [],
	// 	session: [],
	// 	verifcation: [],
	// }),
	trustedOrigins: ["http://localhost:5173"],
	emailAndPassword: {
		enabled: true,
	},
});
