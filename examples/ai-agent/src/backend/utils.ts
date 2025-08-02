export async function getWeather(location: string) {
	// Mock weather API response
	const temperature = Math.floor(Math.random() * 30) + 10;
	const condition = ["sunny", "cloudy", "rainy", "snowy"][
		Math.floor(Math.random() * 4)
	];
	const humidity = Math.floor(Math.random() * 50) + 30;

	// Return a formatted string that the AI can use directly
	return `The weather in ${location} is currently ${condition} with a temperature of ${temperature}°C and humidity at ${humidity}%.`;
}
