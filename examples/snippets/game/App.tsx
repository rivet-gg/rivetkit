import { createClient } from "@rivetkit/actor/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useEffect, useRef, useState } from "react";
import type { Player } from "./actor";

const client = createClient("http://localhost:8080");
const { useActor, useActorEvent } = createReactRivetKit(client);

export function MultiplayerGame() {
	const [{ actor, connectionId }] = useActor("gameRoom");
	const [players, setPlayers] = useState<Player[]>([]);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const keysPressed = useRef<Record<string, boolean>>({});

	// Set up game
	useEffect(() => {
		if (!actor) return;

		// Set up keyboard handlers
		const handleKeyDown = (e: KeyboardEvent) => {
			keysPressed.current[e.key.toLowerCase()] = true;
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			keysPressed.current[e.key.toLowerCase()] = false;
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		// Input update loop
		const inputInterval = setInterval(() => {
			const input = { x: 0, y: 0 };

			if (keysPressed.current["w"] || keysPressed.current["arrowup"])
				input.y = -1;
			if (keysPressed.current["s"] || keysPressed.current["arrowdown"])
				input.y = 1;
			if (keysPressed.current["a"] || keysPressed.current["arrowleft"])
				input.x = -1;
			if (keysPressed.current["d"] || keysPressed.current["arrowright"])
				input.x = 1;

			actor.setInput(input);
		}, 50);

		// Rendering loop
		const renderLoop = () => {
			const canvas = canvasRef.current;
			if (!canvas) return;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Use for loop instead of forEach
			for (let i = 0; i < players.length; i++) {
				const player = players[i];
				ctx.fillStyle = player.id === connectionId ? "blue" : "gray";
				ctx.beginPath();
				ctx.arc(player.position.x, player.position.y, 10, 0, Math.PI * 2);
				ctx.fill();
			}

			requestAnimationFrame(renderLoop);
		};

		const animationId = requestAnimationFrame(renderLoop);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			clearInterval(inputInterval);
			cancelAnimationFrame(animationId);
		};
	}, [actor, connectionId, players]);

	// Listen for world updates
	useActorEvent({ actor, event: "worldUpdate" }, ({ playerList }) => {
		setPlayers(playerList);
	});

	return (
		<div>
			<canvas
				ref={canvasRef}
				width={800}
				height={600}
				style={{ border: "1px solid black" }}
			/>
			<p>Move: WASD or Arrow Keys</p>
		</div>
	);
}
