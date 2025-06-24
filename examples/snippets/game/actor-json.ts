import { actor } from "@rivetkit/worker";

export type Position = { x: number; y: number };
export type Input = { x: number; y: number };
export type Player = { id: string; position: Position; input: Input };

const gameRoom = actor({
  state: {
    players: {} as Record<string, Player>,
    mapSize: 800
  },
  
  onStart: (c) => {
    // Set up game update loop
    setInterval(() => {
      const worldUpdate = { playerList: [] };
      
      for (const id in c.state.players) {
        const player = c.state.players[id];
        const speed = 5;
        
        // Update position based on input
        player.position.x += player.input.x * speed;
        player.position.y += player.input.y * speed;
        
        // Keep player in bounds
        player.position.x = Math.max(0, Math.min(player.position.x, c.state.mapSize));
        player.position.y = Math.max(0, Math.min(player.position.y, c.state.mapSize));
        
        // Add to list for broadcast
        worldUpdate.playerList.push(player);
      }
      
      // Broadcast world state
      c.broadcast("worldUpdate", worldUpdate);
    }, 50);
  },
  
  // Add player to game
  onConnect: (c) => {
    const id = c.conn.id;
    c.state.players[id] = { 
      id, 
      position: {
        x: Math.floor(Math.random() * c.state.mapSize),
        y: Math.floor(Math.random() * c.state.mapSize)
      },
      input: { x: 0, y: 0 }
    };
  },
  
  // Remove player from game
  onDisconnect: (c) => {
    delete c.state.players[c.conn.id];
  },
  
  actions: {
    // Update movement
    setInput: (c, input: Input) => {
      const player = c.state.players[c.conn.id];
      if (player) player.input = input;
    }
  }
});

export default gameRoom;
