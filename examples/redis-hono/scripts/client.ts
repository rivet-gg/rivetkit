async function testAPI() {
	const baseUrl = "http://localhost:8088";

	console.log("Redis + Hono Example Client");
	console.log("===========================");

	try {
		// Test health endpoint
		console.log("1. Testing health endpoint...");
		const healthResponse = await fetch(`${baseUrl}/health`);
		const health = await healthResponse.json();
		console.log("Health:", health);

		// Test counter API
		console.log("\n2. Testing counter API...");

		// Increment counter
		console.log("Incrementing counter 'demo' by 5...");
		const incrementResponse = await fetch(`${baseUrl}/counter/demo/increment`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ amount: 5 }),
		});
		const incrementResult = await incrementResponse.json();
		console.log("Increment result:", incrementResult);

		// Get counter value
		console.log("Getting counter value...");
		const getResponse = await fetch(`${baseUrl}/counter/demo`);
		const getResult = await getResponse.json();
		console.log("Counter value:", getResult);

		// Test chat API
		console.log("\n3. Testing chat API...");

		// Send messages
		console.log("Sending messages to chat room 'general'...");

		const messages = [
			{ user: "Alice", text: "Hello everyone!" },
			{ user: "Bob", text: "Hi Alice! How are you?" },
			{ user: "Alice", text: "I'm doing great, thanks!" },
		];

		for (const message of messages) {
			const messageResponse = await fetch(`${baseUrl}/chat/general/message`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(message),
			});
			const messageResult = (await messageResponse.json()) as { message: any };
			console.log(`Sent message from ${message.user}:`, messageResult.message);
		}

		// Get messages
		console.log("\nGetting all messages...");
		const messagesResponse = await fetch(`${baseUrl}/chat/general/messages`);
		const messagesResult = (await messagesResponse.json()) as {
			messages: any[];
		};
		console.log("Messages:", messagesResult.messages);

		// Test multiple counters
		console.log("\n4. Testing multiple counters...");

		const counters = ["counter1", "counter2", "counter3"];
		for (let i = 0; i < counters.length; i++) {
			const counter = counters[i];
			const amount = (i + 1) * 10;

			const response = await fetch(`${baseUrl}/counter/${counter}/increment`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount }),
			});
			const result = (await response.json()) as { count: number };
			console.log(
				`Counter '${counter}' incremented by ${amount}:`,
				result.count,
			);
		}

		// Reset a counter
		console.log("\n5. Resetting counter 'demo'...");
		const resetResponse = await fetch(`${baseUrl}/counter/demo/reset`, {
			method: "POST",
		});
		const resetResult = await resetResponse.json();
		console.log("Reset result:", resetResult);

		console.log("\n✅ All tests completed successfully!");
		console.log("\nTry these curl commands:");
		console.log(`curl ${baseUrl}`);
		console.log(`curl ${baseUrl}/health`);
		console.log(
			`curl -X POST ${baseUrl}/counter/test/increment -H 'Content-Type: application/json' -d '{"amount": 5}'`,
		);
		console.log(`curl ${baseUrl}/counter/test`);
	} catch (error) {
		console.error("❌ Error testing API:", error);
		console.log("\nMake sure the server is running with: npm run dev");
	}
}

testAPI();
