"use client";
import { useState } from "react";
import { useActor } from "@/lib/rivet-client";
import styles from "./Counter.module.css";

export function Counter() {
	const [count, setCount] = useState(0);
	const [counterName, setCounterName] = useState("test-counter");

	const counter = useActor({
		name: "counter",
		key: [counterName],
	});

	counter.useEvent("newCount", (x: number) => setCount(x));

	const increment = async () => {
		await counter.connection?.increment(1);
	};

	return (
		<div>
			<div className={styles.field}>
				<label htmlFor="counterName">Counter Name:</label>
				<input
					id="counterName"
					name="counterName"
					type="text"
					value={counterName}
					onChange={(e) => setCounterName(e.target.value)}
					placeholder="Counter name"
				/>
			</div>

			<div className={styles.counter}>
				<p>
					Counter: <span className={styles.counterValue}>{count}</span>
				</p>
			</div>
			<button className={styles.button} type="button" onClick={increment}>
				Increment
			</button>
		</div>
	);
}
