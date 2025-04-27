
const celsiusToFahrenheit = (celsius: number) => (celsius * 9/5) + 32;

export async function getWeather(coords: {longitude: number, latitude: number}): Promise<{ forecast: string, temperature: number }> {
  try {
    // Using OpenWeatherMap API which has a free tier
    const apiKey = process.env.API_NINJA_API_KEY || null;

    if (apiKey === null) {
      return { forecast: "Cloudy with chance of meatballs", temperature: 100 }
    }

    const url = `https://api.api-ninjas.com/v1/weatherforecast?lon=${coords.longitude}&lat=${coords.latitude}&`;

    const response = await fetch(url, {
        headers: {
            'X-Api-Key': apiKey
        }
    });
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    const today = data[0];
    const forecast = today.weather;
    const temperature = celsiusToFahrenheit(today.temp);

    return {temperature: Math.floor(temperature), forecast: forecast};
  } catch (error) {
    console.error('Error fetching weather data:', error);
    throw new Error('Failed to fetch weather data');
  }
}