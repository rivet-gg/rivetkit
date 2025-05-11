import type { ActorContext } from "@rivet-gg/actor-core";

export interface RivetHandler {
	start(ctx: ActorContext): Promise<void>;
}

// Constants for key handling
export const EMPTY_KEY = "(none)";
export const KEY_SEPARATOR = ",";

/**
 * Serializes an array of key strings into a single string for storage in a Rivet tag
 * 
 * @param key Array of key strings to serialize
 * @returns A single string containing the serialized key
 */
export function serializeKeyForTag(key: string[]): string {
	// Use a special marker for empty key arrays
	if (key.length === 0) {
		return EMPTY_KEY;
	}
	
	// Escape each key part to handle the separator and the empty key marker
	const escapedParts = key.map(part => {
		// First check if it matches our empty key marker
		if (part === EMPTY_KEY) {
			return `\\${EMPTY_KEY}`;
		}
		
		// Escape backslashes first, then commas
		let escaped = part.replace(/\\/g, "\\\\");
		escaped = escaped.replace(/,/g, "\\,");
		return escaped;
	});
	
	return escapedParts.join(KEY_SEPARATOR);
}

/**
 * Deserializes a key string from a Rivet tag back into an array of key strings
 * 
 * @param keyString The serialized key string from a tag
 * @returns Array of key strings
 */
export function deserializeKeyFromTag(keyString: string): string[] {
	// Handle empty values
	if (!keyString) {
		return [];
	}
	
	// Check for special empty key marker
	if (keyString === EMPTY_KEY) {
		return [];
	}
	
	// Split by unescaped commas and unescape the escaped characters
	const parts: string[] = [];
	let currentPart = '';
	let escaping = false;
	
	for (let i = 0; i < keyString.length; i++) {
		const char = keyString[i];
		
		if (escaping) {
			// This is an escaped character, add it directly
			currentPart += char;
			escaping = false;
		} else if (char === '\\') {
			// Start of an escape sequence
			escaping = true;
		} else if (char === KEY_SEPARATOR) {
			// This is a separator
			parts.push(currentPart);
			currentPart = '';
		} else {
			// Regular character
			currentPart += char;
		}
	}
	
	// Add the last part if it exists
	if (currentPart || parts.length > 0) {
		parts.push(currentPart);
	}
	
	return parts;
}
