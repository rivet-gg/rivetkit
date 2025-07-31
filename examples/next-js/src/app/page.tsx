import { Counter } from "@/components/Counter";
import styles from "./page.module.css";

export default function Home() {
	return (
		<div className={styles.page}>
			<main className={styles.main}>
				<Counter />
			</main>
		</div>
	);
}
