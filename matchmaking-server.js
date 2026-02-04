// Local matchmaking server for Battle Royale game
const http = require('http');

let lobbies = [];

// Clean up old lobbies (older than 30 minutes)
function cleanupOldLobbies() {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    lobbies = lobbies.filter(lobby => lobby.timestamp > thirtyMinutesAgo);
}

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    cleanupOldLobbies();

    // Parse URL
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Only handle /api/lobbies endpoint
    if (url.pathname !== '/api/lobbies') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    // GET - List all public lobbies
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            lobbies: lobbies.map(l => ({
                peerId: l.peerId,
                hostName: l.hostName,
                playerCount: l.playerCount,
                maxPlayers: l.maxPlayers,
                timestamp: l.timestamp
            }))
        }));
        return;
    }

    // POST - Create/Update a lobby
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { peerId, hostName, playerCount, maxPlayers } = JSON.parse(body);

                if (!peerId || !hostName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                // Check if lobby already exists
                const existingIndex = lobbies.findIndex(l => l.peerId === peerId);

                if (existingIndex >= 0) {
                    // Update existing lobby
                    lobbies[existingIndex] = {
                        peerId,
                        hostName,
                        playerCount: playerCount || 1,
                        maxPlayers: maxPlayers || 10,
                        timestamp: Date.now()
                    };
                } else {
                    // Create new lobby
                    lobbies.push({
                        peerId,
                        hostName,
                        playerCount: playerCount || 1,
                        maxPlayers: maxPlayers || 10,
                        timestamp: Date.now()
                    });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // DELETE - Remove a lobby
    if (req.method === 'DELETE') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { peerId } = JSON.parse(body);

                if (!peerId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing peerId' }));
                    return;
                }

                lobbies = lobbies.filter(l => l.peerId !== peerId);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🎮 Matchmaking server running on http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/lobbies`);
});
