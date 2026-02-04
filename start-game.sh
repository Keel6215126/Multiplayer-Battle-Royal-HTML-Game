#!/bin/bash

echo "🎮 Starting Battle Royale Game Servers..."
echo ""

# Start matchmaking server in background
echo "📡 Starting matchmaking server on port 3000..."
python3 matchmaking-server.py &
MATCHMAKING_PID=$!

# Wait a moment for matchmaking server to start
sleep 2

# Start game HTTP server
echo "🌐 Starting game HTTP server on port 8080..."
echo ""
echo "✅ Game is ready!"
echo "   🎮 Game: http://localhost:8080"
echo "   📡 Matchmaking API: http://localhost:3000/api/lobbies"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Trap Ctrl+C to kill both servers
trap "echo ''; echo 'Stopping servers...'; kill $MATCHMAKING_PID 2>/dev/null; exit 0" INT

python3 -m http.server 8080
