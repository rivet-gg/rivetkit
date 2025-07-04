export const LandingQuotes = () => {
  return (
    <>
      {/* Quotes Layout */}
      <div>
          <div className="text-center">
              <h2 className="landing-section-heading">What People Are Saying</h2>
              <p className="landing-section-text">From the platform formerly known as Twitter</p>
          </div>

          <div style={{ height: '40px' }} />

          <div className="quotes-container">
            {/* Column 1 */}
            <div className="quotes-column">
              <a href="https://x.com/devgerred/status/1903178025598083285" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/devgerred.jpg" alt="gerred" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">gerred</p>
                    <p className="quote-author-handle">@devgerred</p>
                  </div>
                </div>
                <p className="quote-content">Nice work, @rivet_gg - nailed it</p>
              </a>

              <a href="https://x.com/samk0_com/status/1909278348812952007" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/samk0_com.jpg" alt="Samo" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">Samo</p>
                    <p className="quote-author-handle">@samk0_com</p>
                  </div>
                </div>
                <p className="quote-content">Great UX & DX possible thanks to @RivetKit_org</p>
                <img src="/images/quotes/posts/1909278348812952007.png" alt="Tweet media" className="quote-image" noZoom />
              </a>

              <a href="https://x.com/Social_Quotient/status/1903172142121832905" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/Social_Quotient.jpg" alt="John Curtis" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">John Curtis</p>
                    <p className="quote-author-handle">@Social_Quotient</p>
                  </div>
                </div>
                <p className="quote-content">Loving RivetKit direction!</p>
              </a>

              <a href="https://x.com/localfirstnews/status/1902752173928427542" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/localfirstnews.jpg" alt="Local-First Newsletter" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">Local-First Newsletter</p>
                    <p className="quote-author-handle">@localfirstnews</p>
                  </div>
                </div>
                <p className="quote-content"><em>Featured in newsletter</em></p>
              </a>

              <a href="https://x.com/Chinoman10_/status/1902020312306216984" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/Chinoman10_.jpg" alt="Chinomso" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">Chinomso</p>
                    <p className="quote-author-handle">@Chinoman10_</p>
                  </div>
                </div>
                <p className="quote-content">Alternatively, some dude (@NathanFlurry) recently told me about @RivetKit_org, which optionally brings you vendor-flexibility (no lock-in since it's abstracted for you).</p>
              </a>
            </div>

            {/* Column 2 */}
            <div className="quotes-column">
              <a href="https://x.com/uripont_/status/1910817946470916525" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/uripont_.jpg" alt="uripont" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">uripont</p>
                    <p className="quote-author-handle">@uripont_</p>
                  </div>
                </div>
                <p className="quote-content">Crazy to think that there are so many things to highlight that is actually hard to convey it in a few words.</p>
              </a>

              <a href="https://x.com/samgoodwin89/status/1910791029609091456" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/samgoodwin89.jpg" alt="sam" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">sam</p>
                    <p className="quote-author-handle">@samgoodwin89</p>
                  </div>
                </div>
                <p className="quote-content">"Durable Objects without the boilerplate"</p>
              </a>

              <a href="https://x.com/j0g1t/status/1902835527977439591" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/j0g1t.jpg" alt="Kacper Wojciechowski" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">Kacper Wojciechowski</p>
                    <p className="quote-author-handle">@j0g1t</p>
                  </div>
                </div>
                <p className="quote-content">Your outie uses @RivetKit_org to develop realtime applications.</p>
                <img src="/images/quotes/posts/1902835527977439591.jpg" alt="Tweet media" className="quote-image" noZoom />
              </a>

              <a href="https://x.com/alistaiir/status/1891312940302716984" className="quote-card" target="_blank" rel="noopener noreferrer">
                <div className="quote-author-section">
                  <img src="/images/quotes/users/alistaiir.jpg" alt="alistair" className="quote-author-avatar" noZoom />
                  <div className="quote-author-info">
                    <p className="quote-author-name">alistair</p>
                    <p className="quote-author-handle">@alistaiir</p>
                  </div>
                </div>
                <p className="quote-content">RivetKit looks super awesome.</p>
              </a>
            </div>
          </div>

          <div style={{ height: '40px' }} />

          {/* Tweet Button */}
          <div className="text-center">
            <a
              href="https://twitter.com/intent/tweet?text=%40RivetKit_org%20"
              className="tweet-button"
              target="_blank"
              rel="noopener noreferrer"
            >
              Share your feedback on X <Icon icon="arrow-right" color="white" />
            </a>
          </div>
      </div>
    </>
  );
};
