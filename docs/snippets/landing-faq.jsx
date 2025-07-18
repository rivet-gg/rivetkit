import { Icon } from "@/components/Icon";
import { useState } from "react";

const FaqAccordion = ({ question, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="faq-accordion" data-state={isOpen ? "open" : "closed"}>
      <button className="faq-question" onClick={handleToggle}>
        {question}
        <Icon icon="chevron-down" size={16} color="white" />
      </button>
      <div className="faq-answer">
        {children}
      </div>
    </div>
  );
};

export const LandingFaq = () => {
  return (
    <div className="text-center">
        <h2 id="faq" className="landing-section-heading">Frequently Asked Questions</h2>
        <p className="landing-section-text">Common questions about stateful serverless and RivetKit.</p>

        <div style={{ height: '40px' }} />


        <div style={{ height: '40px' }} />
        
        <div className="text-center">
            <p className="text-lg">
                Have more questions? Join our <a href="https://discord.gg/rivet" className="text-primary hover:text-primary-dark">Discord</a> or go to <a href="https://github.com/rivet-gg/rivetkit/discussions" className="text-primary hover:text-primary-dark">GitHub Discussions</a>.
            </p>
        </div>
    </div> 
  );
};

