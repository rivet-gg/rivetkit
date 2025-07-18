import { useState } from "react";

const CTA_TITLES = [
  "Performance in every act - thanks to Rivet Actors.",
  "Scale without drama - only with Rivet Actors.",
  "It's time your backend took center-stage - with Rivet Actors.",
  "SQLite the spotlight on performance - with Rivet Actors.",
  "Backend scalability: the SQL - starring Rivet Actors.",
  "Take your state to the edge - Rivet Actors makes it easy.",
  "No state fright - just scalability with Rivet Actors.",
  "Act now, deploy at the edge - with Rivet Actors.",
  "Lights, camera, serverless - powered by Rivet Actors.",
  "Your backend deserves a standing ovation - Rivet Actors delivers.",
  "Cue your backend's best performance - enter Rivet Actors.",
  "Backend performance worth applauding - only with Rivet Actors.",
  "Put your backend center-stage - with Rivet Actors.",
  "Make your backend the main actor - with Rivet Actors.",
  "Give your backend its big break - use Rivet Actors.",
  "Serverless, with no intermissions - powered by Rivet Actors.",
  "Set the stage for serverless success - with Rivet Actors."
];

export const Cta = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [clickCount, setClickCount] = useState(0);

  const getNextTitle = () => {
    const nextIndex = (currentIndex + 1) % CTA_TITLES.length;
    setCurrentIndex(nextIndex);
    return CTA_TITLES[nextIndex];
  };

  const handleComplaintClick = () => {
    const newTitle = getNextTitle();
    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);
  };

  const getComplaintText = () => {
    if (clickCount === 0) {
      return "Click here to file a complaint for bad puns.";
    } else if (clickCount === 1) {
      return "Click here to file another complaint.";
    } else if (clickCount === 2) {
      return "And another.";
    } else if (clickCount === 3) {
      return "Keep clicking.";
    } else if (clickCount === 4) {
      return "I promise this one will stop the puns.";
    } else if (clickCount === 5) {
      return "Fool me once, shame on me. Fool me twice... keep clicking.";
    } else if (clickCount === 6) {
      return "Insanity is doing the same thing over and over again and expecting different results.";
    } else {
      return `Your measure of insanity: ${clickCount}`;
    }
  };

  return (
    <div className="cta-section landing-section">
      <h2 className="cta-title" id="rotating-cta-title">
        {CTA_TITLES[currentIndex]}
      </h2>
      <div style={{ height: "16px" }} />
      <div className="landing-buttons">
        <a href="/actors/overview" className="landing-button landing-button-primary">
          Get Started
        </a>
        <a href="https://github.com/rivet-gg/rivetkit" target="_blank" className="landing-button landing-button-secondary">
          View on GitHub
        </a>
      </div>
      <div style={{ height: "8px" }} />
      <p className="cta-pun-complaint" onClick={handleComplaintClick}>
        {getComplaintText()}
      </p>
    </div>
  );
};