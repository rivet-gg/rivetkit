import ChatRoomJs from "/snippets/examples/chat-room-js.mdx";
import ChatRoomSqlite from "/snippets/examples/chat-room-sqlite.mdx";
// import ChatRoomReact from "/snippets/examples/chat-room-react.mdx";
// import AiAgentJs from "/snippets/examples/ai-agent-js.mdx";
// import AiAgentSqlite from "/snippets/examples/ai-agent-sqlite.mdx";
// import AiAgentReact from "/snippets/examples/ai-agent-react.mdx";
// import SyncJs from "/snippets/examples/sync-js.mdx";
// import SyncSqlite from "/snippets/examples/sync-sqlite.mdx";
// import SyncReact from "/snippets/examples/sync-react.mdx";
// import TenantJs from "/snippets/examples/tenant-js.mdx";
// import TenantSqlite from "/snippets/examples/tenant-sqlite.mdx";
// import TenantReact from "/snippets/examples/tenant-react.mdx";
// import DatabaseJs from "/snippets/examples/database-js.mdx";
// import DatabaseSqlite from "/snippets/examples/database-sqlite.mdx";
// import DatabaseReact from "/snippets/examples/database-react.mdx";
// import CrdtJs from "/snippets/examples/crdt-js.mdx";
// import CrdtSqlite from "/snippets/examples/crdt-sqlite.mdx";
// import CrdtReact from "/snippets/examples/crdt-react.mdx";
// import DocumentJs from "/snippets/examples/document-js.mdx";
// import DocumentSqlite from "/snippets/examples/document-sqlite.mdx";
// import DocumentReact from "/snippets/examples/document-react.mdx";
// import StreamJs from "/snippets/examples/stream-js.mdx";
// import StreamSqlite from "/snippets/examples/stream-sqlite.mdx";
// import StreamReact from "/snippets/examples/stream-react.mdx";
// import GameJs from "/snippets/examples/game-js.mdx";
// import GameSqlite from "/snippets/examples/game-sqlite.mdx";
// import GameReact from "/snippets/examples/game-react.mdx";
// import RateJs from "/snippets/examples/rate-js.mdx";
// import RateSqlite from "/snippets/examples/rate-sqlite.mdx";
// import RateReact from "/snippets/examples/rate-react.mdx";
import { Icon } from "@/components/Icon";
import { useState, useEffect, useRef } from "react";


export const LandingSnippets = () => {
  const [activeType, setActiveType] = useState("ai");
  const [activeStorage, setActiveStorage] = useState("memory");
  const primaryTabsRef = useRef(null);

  const checkOverflow = () => {
    if (!primaryTabsRef.current) return;
    
    const container = primaryTabsRef.current;
    const hasRightOverflow = container.scrollLeft < container.scrollWidth - container.clientWidth;
    const hasLeftOverflow = container.scrollLeft > 0;
    
    container.classList.toggle('has-overflow', hasRightOverflow);
    container.classList.toggle('has-start-overflow', hasLeftOverflow);
  };

  const handleScroll = (direction) => {
    if (!primaryTabsRef.current) return;
    
    primaryTabsRef.current.scrollBy({
      left: direction === 'left' ? -200 : 200,
      behavior: 'smooth'
    });
  };

  useEffect(() => {
    checkOverflow();
    
    const handleResize = () => checkOverflow();
    window.addEventListener('resize', handleResize);
    
    const container = primaryTabsRef.current;
    if (container) {
      container.addEventListener('scroll', checkOverflow);
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('scroll', checkOverflow);
      }
    };
  }, []);

  const handleTabClick = (tabValue, tabType) => {
    if (tabType === 'primary') {
      setActiveType(tabValue);
    } else {
      setActiveStorage(tabValue);
    }
  };

  return (<div>
    <CodeBlock filename="test">
        <pre>let x = 5;</pre>
    </CodeBlock>

  </div>)
  // return (
  //   <div className="code-group">
  //     <div className="code-group-tabs">
  //       {/* Scroll Bars */}
  //       <div className="scroll-indicators-overlay">
  //         <div className="scroll-indicator left" onClick={() => handleScroll('left')}>
  //           <Icon icon="chevron-left" color="white" size={14} />
  //         </div>
  //         <div className="scroll-indicator right" onClick={() => handleScroll('right')}>
  //           <Icon icon="chevron-right" color="white" size={14} />
  //         </div>
  //       </div>
  //
  //       {/* Examples */}
  //       <div className="code-group-tab-row primary-tabs" ref={primaryTabsRef}>
  //         <div className="code-group-tab-row-inner">
  //           <div className="code-group-tab-label">Example</div>
  //           <div 
  //             className={`code-group-tab ${activeType === "ai" ? "active" : ""}`} 
  //             data-tab="ai"
  //             onClick={() => handleTabClick("ai", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("ai", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="robot" color="white" size={14} />
  //             AI Agent
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "crdt" ? "active" : ""}`} 
  //             data-tab="crdt"
  //             onClick={() => handleTabClick("crdt", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("crdt", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="file-pen" color="white" size={14} />
  //             Collaborative Document (CRDT)
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "chat" ? "active" : ""}`} 
  //             data-tab="chat"
  //             onClick={() => handleTabClick("chat", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("chat", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="message" color="white" size={14} />
  //             Chat Room
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "database" ? "active" : ""}`} 
  //             data-tab="database"
  //             onClick={() => handleTabClick("database", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("database", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="database" color="white" size={14} />
  //             Per-User Databases
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "rate" ? "active" : ""}`} 
  //             data-tab="rate"
  //             onClick={() => handleTabClick("rate", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("rate", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="gauge-high" color="white" size={14} />
  //             Rate Limiter
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "stream" ? "active" : ""}`} 
  //             data-tab="stream"
  //             onClick={() => handleTabClick("stream", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("stream", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="wave-sine" color="white" size={14} />
  //             Stream Processing
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "game" ? "active" : ""}`} 
  //             data-tab="game"
  //             onClick={() => handleTabClick("game", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("game", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="gamepad" color="white" size={14} />
  //             Multiplayer Game
  //           </div>
  //           <div 
  //             className={`code-group-tab ${activeType === "sync" ? "active" : ""}`} 
  //             data-tab="sync"
  //             onClick={() => handleTabClick("sync", "primary")}
  //             onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("sync", "primary") : null}
  //             tabIndex="0"
  //           >
  //             <Icon icon="rotate" color="white" size={14} />
  //             Local-First Sync
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* State */}
  //       <div className="code-group-tab-row secondary-tabs">
  //         <div className="code-group-tab-label">State</div>
  //         <div 
  //           className={`code-group-tab ${activeStorage === "memory" ? "active" : ""}`} 
  //           data-tab="memory"
  //           onClick={() => handleTabClick("memory", "secondary")}
  //           onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("memory", "secondary") : null}
  //           tabIndex="0"
  //         >
  //           JavaScript
  //         </div>
  //         <div 
  //           className={`code-group-tab ${activeStorage === "sqlite" ? "active" : ""}`} 
  //           data-tab="sqlite"
  //           onClick={() => handleTabClick("sqlite", "secondary")}
  //           onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? handleTabClick("sqlite", "secondary") : null}
  //           tabIndex="0"
  //         >
  //           SQLite<span className="code-group-coming-soon">Available In July</span>
  //         </div>
  //       </div>
  //     </div>
  //
  //     {/* Code */}
  //     <div className="code-group-panels">
  //       {/* AI Agent */}
  //       <div className={`code-panel ${activeType === "ai" && activeStorage === "memory" ? "active" : ""}`} data-panel="ai-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <AiAgentJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <AiAgentReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "ai" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="ai-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <AiAgentSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <AiAgentReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Collaborative Document (CRDT) */}
  //       <div className={`code-panel ${activeType === "crdt" && activeStorage === "memory" ? "active" : ""}`} data-panel="crdt-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <CrdtJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <CrdtReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "crdt" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="crdt-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <CrdtSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <CrdtReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Chat Room */}
  //       <div className={`code-panel ${activeType === "chat" && activeStorage === "memory" ? "active" : ""}`} data-panel="chat-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <ChatRoomJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <ChatRoomReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "chat" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="chat-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <ChatRoomSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <ChatRoomReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Per-User Databases */}
  //       <div className={`code-panel ${activeType === "database" && activeStorage === "memory" ? "active" : ""}`} data-panel="database-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <DatabaseJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <DatabaseReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "database" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="database-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <DatabaseSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <DatabaseReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Rate Limiter */}
  //       <div className={`code-panel ${activeType === "rate" && activeStorage === "memory" ? "active" : ""}`} data-panel="rate-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <RateJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <RateReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "rate" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="rate-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <RateSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <RateReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Stream Processing */}
  //       <div className={`code-panel ${activeType === "stream" && activeStorage === "memory" ? "active" : ""}`} data-panel="stream-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <StreamJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <StreamReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "stream" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="stream-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <StreamSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <StreamReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //
  //       {/* Multiplayer Game */}
  //       <div className={`code-panel ${activeType === "game" && activeStorage === "memory" ? "active" : ""}`} data-panel="game-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <GameJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <GameReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "game" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="game-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <GameSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <GameReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       {/* Local-First Sync */}
  //       <div className={`code-panel ${activeType === "sync" && activeStorage === "memory" ? "active" : ""}`} data-panel="sync-memory">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <SyncJs />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <SyncReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //
  //       <div className={`code-panel ${activeType === "sync" && activeStorage === "sqlite" ? "active" : ""}`} data-panel="sync-sqlite">
  //         <div className="code-split">
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">actor.ts</span>
  //               <span className="file-description">Runs on the server</span>
  //             </div>
  //             <div className="code-block">
  //               <SyncSqlite />
  //             </div>
  //           </div>
  //
  //           <div className="code-split-panel">
  //             <div className="code-panel-title">
  //               <span className="file-name">App.tsx</span>
  //               <span className="file-description">Runs in the browser</span>
  //             </div>
  //             <div className="code-block">
  //               <SyncReact />
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   </div>
  // );
};
