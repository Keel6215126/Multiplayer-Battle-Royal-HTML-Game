// Game state
let peer;
let myPeerId;
let connections = new Map();
let players = new Map();
let myPlayer;
let isHost = false;
let isPublicLobby = false;
let gameInProgress = false;

// Matchmaking API URL - Vercel deployment
const MATCHMAKING_API = 'https://idk-umber-sigma.vercel.app/api/lobbies';

// Three.js variables
let scene, camera, renderer;
let terrain;
let keys = {};
let isPointerLocked = false;
let isMenuOpen = false;
let cameraRotation = { yaw: 0, pitch: 0 };
let currentWeaponMesh = null;
let weaponModels = {};

// Game constants
const MOVE_SPEED = 0.15;
const ROTATION_SPEED = 0.002;
const JUMP_FORCE = 0.3;
const GRAVITY = 0.02;
const GROUND_LEVEL = 1.6;

// Jump state
let isJumping = false;
let verticalVelocity = 0;

// Bot management
let bots = [];
const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Ghost', 'Hunter', 'Viper', 'Shadow'];

// Building system
let buildMode = false;
let currentBuildPiece = 'wall'; // wall, floor, ramp
let materials = 500;
let placedBuildings = [];
let buildPreview = null;
let buildRotation = 0; // 0, 90, 180, 270 degrees
const BUILD_DISTANCE = 5;
const BUILD_COST = { wall: 10, floor: 10, ramp: 10 };
const BUILD_PIECES = {
    wall: { width: 3, height: 3, depth: 0.2, color: 0x8B7355 },
    floor: { width: 3, height: 0.2, depth: 3, color: 0x654321 },
    ramp: { width: 3, height: 3, depth: 3, color: 0x704214 }
};

// Weapon system
const WEAPONS = {
    pistol: {
        name: 'Pistol',
        damage: 15,
        fireRate: 400,
        maxAmmo: 12,
        reloadTime: 1500,
        range: 50,
        color: 0xffff00,
        trailWidth: 1
    },
    rifle: {
        name: 'Assault Rifle',
        damage: 25,
        fireRate: 150,
        maxAmmo: 30,
        reloadTime: 2000,
        range: 100,
        color: 0xff6600,
        trailWidth: 1.5
    },
    sniper: {
        name: 'Sniper',
        damage: 75,
        fireRate: 1200,
        maxAmmo: 5,
        reloadTime: 2500,
        range: 200,
        color: 0x00ffff,
        trailWidth: 2
    }
};

let currentWeapon = 'rifle';
let ammo = WEAPONS.rifle.maxAmmo;
let isReloading = false;
let lastShootTime = 0;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    setupDisconnectHandlers();
});

// Handle tab close / browser close
function setupDisconnectHandlers() {
    window.addEventListener('beforeunload', () => {
        handlePlayerDisconnection();
    });
    
    // Handle tab visibility change (mobile/background)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && gameInProgress) {
            handlePlayerDisconnection();
        }
    });
}

function handlePlayerDisconnection() {
    if (myPeerId && gameInProgress) {
        // Broadcast disconnect message
        broadcast({
            type: 'playerDisconnected',
            id: myPeerId
        });
        
        // Clean up connections
        cleanupGame();
    }
}

function cleanupGame() {
    // Close all peer connections
    connections.forEach(conn => {
        try {
            conn.close();
        } catch (e) {}
    });
    connections.clear();
    
    // Destroy peer
    if (peer && !peer.destroyed) {
        try {
            peer.destroy();
        } catch (e) {}
    }
    
    // Unregister public lobby
    if (isPublicLobby && myPeerId) {
        unregisterPublicLobby();
    }
}

function initUI() {
    document.getElementById('playBtn').addEventListener('click', autoMatchmake);
    document.getElementById('createLobbyBtn').addEventListener('click', createLobby);
    document.getElementById('joinLobbyBtn').addEventListener('click', joinLobby);
    document.getElementById('browseGamesBtn').addEventListener('click', showPublicGames);
    document.getElementById('refreshGamesBtn').addEventListener('click', loadPublicGames);
    document.getElementById('backFromBrowseBtn').addEventListener('click', () => {
        document.getElementById('publicGamesScreen').style.display = 'none';
        document.getElementById('menuScreen').style.display = 'block';
    });
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('leaveLobbyBtn').addEventListener('click', leaveLobby);
    document.getElementById('addBotBtn').addEventListener('click', addBot);
    document.getElementById('removeBotBtn').addEventListener('click', removeBot);
}

async function autoMatchmake() {
    const playerName = document.getElementById('playerNameInput').value.trim() || 'Player';
    
    showStatus('Finding match...');
    
    try {
        // Try to find an existing public lobby
        const response = await fetch(MATCHMAKING_API, { timeout: 5000 });
        const data = await response.json();
        
        // Filter out stale lobbies (older than 2 minutes)
        const now = Date.now();
        const validLobbies = data.lobbies ? data.lobbies.filter(lobby => {
            return (now - lobby.timestamp) < 120000; // 2 minutes
        }) : [];
        
        if (validLobbies.length > 0) {
            // Try to join lobbies, skip if connection fails
            let joined = false;
            for (const lobby of validLobbies) {
                try {
                    showStatus(`Joining ${lobby.hostName}'s game...`);
                    await attemptJoinLobby(lobby.peerId, lobby.hostName, playerName);
                    joined = true;
                    break;
                } catch (err) {
                    console.log(`Failed to join ${lobby.hostName}'s game, trying next...`);
                    continue;
                }
            }
            
            if (!joined) {
                // All lobbies failed, create new one
                showStatus('Creating new match...');
                createPublicMatch(playerName);
            }
        } else {
            // No lobbies available, create a new public one
            showStatus('Creating new match...');
            createPublicMatch(playerName);
        }
    } catch (err) {
        console.error('Matchmaking error:', err);
        showError('Could not connect to matchmaking server. Creating offline game...');
        
        // Fallback: create an offline game with bots
        createOfflineMatch(playerName);
    }
}

function createPublicMatch(playerName) {
    isPublicLobby = true;
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        isHost = true;
        
        myPlayer = {
            id: myPeerId,
            name: playerName,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            health: 100
        };
        
        players.set(myPeerId, myPlayer);
        
        // Add bots to the lobby automatically
        for (let i = 0; i < 3; i++) {
            setTimeout(() => addBot(), i * 100);
        }
        
        document.getElementById('menuScreen').style.display = 'none';
        document.getElementById('lobbyRoomScreen').style.display = 'block';
        document.getElementById('myPeerId').textContent = myPeerId;
        document.getElementById('lobbyTypeLabel').textContent = '🌐 Public Match';
        
        registerPublicLobby(playerName);
        showSuccess('Waiting for players...');
        updatePlayersList();
        
        // Auto-start game after 15 seconds if no one joins
        setTimeout(() => {
            if (isHost && !gameInProgress) {
                startGame();
            }
        }, 15000);
    });
    
    peer.on('connection', (conn) => {
        handleConnection(conn);
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        showError('Connection error. Creating offline match...');
        createOfflineMatch(playerName);
    });
}

function createOfflineMatch(playerName) {
    isPublicLobby = false;
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        isHost = true;
        
        myPlayer = {
            id: myPeerId,
            name: playerName,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            health: 100
        };
        
        players.set(myPeerId, myPlayer);
        
        // Add bots
        for (let i = 0; i < 5; i++) {
            setTimeout(() => addBot(), i * 100);
        }
        
        document.getElementById('menuScreen').style.display = 'none';
        document.getElementById('lobbyRoomScreen').style.display = 'block';
        document.getElementById('myPeerId').textContent = 'Offline Mode';
        document.getElementById('lobbyTypeLabel').textContent = '🤖 Bot Match';
        
        showSuccess('Playing with bots!');
        updatePlayersList();
        
        setTimeout(() => {
            if (isHost && !gameInProgress) {
                startGame();
            }
        }, 3000);
    });
}

function attemptJoinLobby(hostPeerId, hostName, playerName) {
    return new Promise((resolve, reject) => {
        const tempPeer = new Peer();
        const timeout = setTimeout(() => {
            tempPeer.destroy();
            reject(new Error('Connection timeout'));
        }, 5000);
        
        tempPeer.on('open', (id) => {
            const conn = tempPeer.connect(hostPeerId);
            
            conn.on('open', () => {
                clearTimeout(timeout);
                
                // Successfully connected, now use this peer
                peer = tempPeer;
                myPeerId = id;
                isHost = false;
                
                myPlayer = {
                    id: myPeerId,
                    name: playerName,
                    position: { x: Math.random() * 20 - 10, y: 0, z: Math.random() * 20 - 10 },
                    rotation: 0,
                    health: 100
                };
                
                players.set(myPeerId, myPlayer);
                handleConnection(conn);
                
                conn.send({
                    type: 'join',
                    player: myPlayer
                });
                
                document.getElementById('menuScreen').style.display = 'none';
                document.getElementById('publicGamesScreen').style.display = 'none';
                document.getElementById('lobbyRoomScreen').style.display = 'block';
                document.getElementById('myPeerId').textContent = myPeerId;
                document.getElementById('lobbyTypeLabel').textContent = '🌐 Public Game';
                
                showSuccess('Connected to game!');
                resolve();
            });
            
            conn.on('error', (err) => {
                clearTimeout(timeout);
                tempPeer.destroy();
                reject(err);
            });
        });
        
        tempPeer.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function createLobby() {
    const playerName = document.getElementById('playerNameInput').value.trim() || 'Player';
    const lobbyType = document.querySelector('input[name="lobbyType"]:checked').value;
    isPublicLobby = (lobbyType === 'public');
    
    showStatus('Connecting...');
    
    // Initialize PeerJS with public server
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        isHost = true;
        
        myPlayer = {
            id: myPeerId,
            name: playerName,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            health: 100
        };
        
        players.set(myPeerId, myPlayer);
        
        document.getElementById('menuScreen').style.display = 'none';
        document.getElementById('lobbyRoomScreen').style.display = 'block';
        document.getElementById('myPeerId').textContent = myPeerId;
        
        // Update lobby type label
        const lobbyTypeLabel = document.getElementById('lobbyTypeLabel');
        if (isPublicLobby) {
            lobbyTypeLabel.textContent = '🌐 Public Game';
            registerPublicLobby(playerName);
            showSuccess('Public lobby created! Visible in Browse Games.');
        } else {
            lobbyTypeLabel.textContent = '🔒 Private Game';
            showSuccess('Private lobby created! Share your Game ID with friends.');
        }
        
        updatePlayersList();
    });
    
    peer.on('connection', (conn) => {
        handleConnection(conn);
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        let errorMessage = 'Connection error: ' + err.type;
        
        if (err.type === 'peer-unavailable') {
            errorMessage = 'Could not connect to host. They may have closed the lobby or their Game ID is incorrect.';
        } else if (err.type === 'network') {
            errorMessage = 'Network error. Check your internet connection.';
        } else if (err.type === 'server-error') {
            errorMessage = 'PeerJS server error. Please try again.';
        } else if (err.type === 'browser-incompatible') {
            errorMessage = 'Your browser does not support WebRTC. Try Chrome or Firefox.';
        }
        
        showError(errorMessage);
    });

    peer.on('disconnected', () => {
        console.warn('Peer disconnected from signaling server, attempting reconnect...');
        setTimeout(() => {
            if (!peer.destroyed) {
                peer.reconnect();
            }
        }, 1000);
    });
}

function leaveLobby() {
    if (isPublicLobby && myPeerId) {
        unregisterPublicLobby();
    }
    location.reload();
}

async function registerPublicLobby() {
    if (!myPeerId) return;
    
    try {
        await fetch(MATCHMAKING_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                peerId: myPeerId,
                hostName: myPlayer.name,
                playerCount: players.size,
                maxPlayers: 10
            })
        });
        
        // Update lobby every 20 seconds to keep it alive
        setInterval(() => {
            if (isPublicLobby && myPeerId) {
                fetch(MATCHMAKING_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        peerId: myPeerId,
                        hostName: myPlayer.name,
                        playerCount: players.size,
                        maxPlayers: 10
                    })
                });
            }
        }, 20000);
    } catch (err) {
        console.error('Failed to register public lobby:', err);
    }
}

async function unregisterPublicLobby() {
    if (!myPeerId) return;
    
    try {
        await fetch(MATCHMAKING_API, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peerId: myPeerId })
        });
    } catch (err) {
        console.error('Failed to unregister lobby:', err);
    }
}

async function showPublicGames() {
    document.getElementById('menuScreen').style.display = 'none';
    document.getElementById('publicGamesScreen').style.display = 'block';
    loadPublicGames();
}

async function loadPublicGames() {
    const loadingEl = document.getElementById('loadingGames');
    const noGamesEl = document.getElementById('noGames');
    const gamesListEl = document.getElementById('gamesListContent');
    
    loadingEl.style.display = 'block';
    noGamesEl.style.display = 'none';
    gamesListEl.style.display = 'none';
    
    try {
        const response = await fetch(MATCHMAKING_API);
        const data = await response.json();
        
        loadingEl.style.display = 'none';
        
        if (data.lobbies && data.lobbies.length > 0) {
            gamesListEl.style.display = 'block';
            gamesListEl.innerHTML = '';
            
            data.lobbies.forEach(lobby => {
                const gameItem = document.createElement('div');
                gameItem.className = 'player-item';
                gameItem.style.cursor = 'pointer';
                gameItem.style.transition = 'all 0.2s';
                
                gameItem.innerHTML = `
                    <div>
                        <div style="font-weight: bold; color: #333;">${lobby.hostName}'s Game</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">
                            Players: ${lobby.playerCount}/${lobby.maxPlayers}
                        </div>
                    </div>
                    <button class="btn btn-secondary" style="min-width: auto; padding: 8px 16px;">
                        Join →
                    </button>
                `;
                
                gameItem.addEventListener('mouseenter', () => {
                    gameItem.style.transform = 'scale(1.02)';
                });
                gameItem.addEventListener('mouseleave', () => {
                    gameItem.style.transform = 'scale(1)';
                });
                
                gameItem.addEventListener('click', () => {
                    joinPublicGame(lobby.peerId, lobby.hostName);
                });
                
                gamesListEl.appendChild(gameItem);
            });
        } else {
            noGamesEl.style.display = 'block';
        }
    } catch (err) {
        loadingEl.style.display = 'none';
        noGamesEl.style.display = 'block';
        noGamesEl.innerHTML = `
            <p style="color: #f44336;">Error loading games</p>
            <p style="font-size: 14px; margin-top: 10px; color: #666;">
                Make sure the matchmaking server is running!
            </p>
        `;
        console.error('Failed to load public games:', err);
    }
}

function joinPublicGame(hostPeerId, hostName) {
    const playerName = document.getElementById('playerNameInput').value.trim() || 'Player';
    
    document.getElementById('publicGamesScreen').style.display = 'none';
    showStatus(`Connecting to ${hostName}'s game...`);
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        isHost = false;
        
        myPlayer = {
            id: myPeerId,
            name: playerName,
            position: { x: Math.random() * 20 - 10, y: 0, z: Math.random() * 20 - 10 },
            rotation: 0,
            health: 100
        };
        
        players.set(myPeerId, myPlayer);
        
        const conn = peer.connect(hostPeerId);
        handleConnection(conn);
        
        conn.on('open', () => {
            conn.send({
                type: 'join',
                player: myPlayer
            });
            
            document.getElementById('lobbyRoomScreen').style.display = 'block';
            document.getElementById('myPeerId').textContent = myPeerId;
            document.getElementById('lobbyTypeLabel').textContent = '🌐 Public Game';
            
            showSuccess('Connected to public game!');
        });
        
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            showError('Failed to connect to game: ' + err.type);
        });
    });
    
    peer.on('error', (err) => {
        showError('Connection error: ' + err.message);
        document.getElementById('menuScreen').style.display = 'block';
    });
}

function joinLobby() {
    const playerName = document.getElementById('playerNameInput').value.trim() || 'Player';
    const hostId = document.getElementById('joinIdInput').value.trim();
    
    if (!hostId) {
        showError('Please enter a Game ID');
        return;
    }
    
    showStatus('Connecting...');
    
    // Initialize PeerJS
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        isHost = false;
        
        myPlayer = {
            id: myPeerId,
            name: playerName,
            position: { x: Math.random() * 20 - 10, y: 0, z: Math.random() * 20 - 10 },
            rotation: 0,
            health: 100
        };
        
        players.set(myPeerId, myPlayer);
        
        // Connect to host
        const conn = peer.connect(hostId);
        handleConnection(conn);
        
        conn.on('open', () => {
            // Send join request
            conn.send({
                type: 'join',
                player: myPlayer
            });
            
            document.getElementById('menuScreen').style.display = 'none';
            document.getElementById('lobbyRoomScreen').style.display = 'block';
            document.getElementById('myPeerId').textContent = myPeerId;
            
            showSuccess('Connected to host!');
        });
        
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            showError('Failed to connect to host: ' + err.type);
        });
    });
    
    peer.on('error', (err) => {
        showError('Connection error: ' + err.message);
    });
}

function handleConnection(conn) {
    connections.set(conn.peer, conn);
    
    conn.on('data', (data) => {
        handleMessage(data, conn);
    });
    
    conn.on('error', (err) => {
        console.error('Connection error with', conn.peer, ':', err);
        showError('Connection error with player. They may have disconnected.');
    });
    
    conn.on('close', () => {
        connections.delete(conn.peer);
        const disconnectedPlayer = players.get(conn.peer);
        
        // Only delete if not a bot (bots are managed separately)
        if (disconnectedPlayer && !disconnectedPlayer.isBot) {
            players.delete(conn.peer);
            updatePlayersList();
            updatePlayerCount();
            
            // Remove player mesh if game started
            if (disconnectedPlayer.mesh && scene) {
                scene.remove(disconnectedPlayer.mesh);
            }
            
            // Check if game should end
            if (gameInProgress) {
                checkGameEndCondition();
            }
        }
    });
}

function handleMessage(data, conn) {
    switch(data.type) {
        case 'join':
            // Host receives join request
            if (isHost) {
                players.set(data.player.id, data.player);
                updatePlayersList();
                
                // Send current player list to new player
                conn.send({
                    type: 'players',
                    players: Array.from(players.values())
                });
                
                // Broadcast new player to others
                broadcastToOthers({
                    type: 'playerJoined',
                    player: data.player
                }, conn.peer);
            }
            break;
            
        case 'players':
            // New player receives full player list
            data.players.forEach(p => {
                if (p.id !== myPeerId) {
                    players.set(p.id, p);
                }
            });
            updatePlayersList();
            break;
            
        case 'playerJoined':
            // Other players notified of new player
            players.set(data.player.id, data.player);
            updatePlayersList();
            break;
            
        case 'startGame':
            // Everyone starts the game
            initGame(data.players);
            break;
            
        case 'playerMove':
            // Update player position
            const player = players.get(data.id);
            if (player) {
                player.targetPosition = data.position;
                player.targetRotation = data.rotation;
            }
            break;
            
        case 'playerShoot':
            // Show shoot effect
            const shootPlayer = players.get(data.id);
            if (shootPlayer && shootPlayer.mesh) {
                const weapon = WEAPONS[data.weapon || 'rifle'];
                createBulletTrail(shootPlayer.mesh.position, data.direction, weapon.color, weapon.trailWidth);
            }
            break;
            
        case 'playerHit':
            // Someone was hit
            if (data.targetId === myPeerId) {
                const damage = data.damage || 20;
                myPlayer.health -= damage;
                updateHealth(myPlayer.health);
                
                if (myPlayer.health <= 0) {
                    myPlayer.health = 0;
                    showEliminatedScreen(data.id);
                    
                    // Check if game should end after death
                    if (isHost) {
                        checkGameEndCondition();
                    }
                    
                    // Respawn after 3 seconds
                    setTimeout(() => {
                        myPlayer.health = 100;
                        myPlayer.position = {
                            x: Math.random() * 40 - 20,
                            y: 0,
                            z: Math.random() * 40 - 20
                        };
                        camera.position.set(myPlayer.position.x, 1.6, myPlayer.position.z);
                        hideEliminatedScreen();
                        updateHealth(100);
                        
                        // Broadcast respawn
                        broadcast({
                            type: 'playerRespawned',
                            id: myPeerId,
                            position: myPlayer.position
                        });
                    }, 3000);
                }
            } else {
                // Update other player/bot health
                const hitPlayer = players.get(data.targetId);
                if (hitPlayer) {
                    hitPlayer.health = (hitPlayer.health || 100) - (data.damage || 20);
                    if (hitPlayer.health <= 0) {
                        hitPlayer.health = 0;
                        if (hitPlayer.mesh) {
                            hitPlayer.mesh.visible = false;
                        }
                        
                        // Respawn bots
                        if (hitPlayer.isBot && isHost) {
                            setTimeout(() => {
                                hitPlayer.health = 100;
                                hitPlayer.position = {
                                    x: Math.random() * 40 - 20,
                                    y: 0,
                                    z: Math.random() * 40 - 20
                                };
                                if (hitPlayer.mesh) {
                                    hitPlayer.mesh.visible = true;
                                    hitPlayer.mesh.position.set(hitPlayer.position.x, 0.9, hitPlayer.position.z);
                                }
                            }, 3000);
                        }
                    }
                }
            }
            
            addKillFeedMessage(data.id, data.targetId);
            break;
            
        case 'playerRespawned':
            const respawnedPlayer = players.get(data.id);
            if (respawnedPlayer && respawnedPlayer.mesh) {
                respawnedPlayer.mesh.position.set(data.position.x, 0.9, data.position.z);
                respawnedPlayer.mesh.visible = true;
                respawnedPlayer.health = 100;
            }
            checkGameEndCondition();
            break;
            
        case 'playerDisconnected':
            // Handle player disconnect
            const disconnectedPlayer = players.get(data.id);
            if (disconnectedPlayer && disconnectedPlayer.mesh && scene) {
                scene.remove(disconnectedPlayer.mesh);
            }
            players.delete(data.id);
            connections.delete(data.id);
            updatePlayerCount();
            
            addKillFeedMessage('System', data.id, true);
            
            if (gameInProgress) {
                checkGameEndCondition();
            }
            break;
            
        case 'buildingPlaced':
            // Other player placed a building
            if (scene && data.piece) {
                const piece = BUILD_PIECES[data.piece];
                let geometry;
                
                if (data.piece === 'ramp') {
                    const shape = new THREE.Shape();
                    shape.moveTo(0, 0);
                    shape.lineTo(3, 0);
                    shape.lineTo(3, 3);
                    shape.lineTo(0, 0);
                    
                    const extrudeSettings = { depth: 3, bevelEnabled: false };
                    geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                } else {
                    geometry = new THREE.BoxGeometry(piece.width, piece.height, piece.depth);
                }
                
                const material = new THREE.MeshStandardMaterial({ 
                    color: piece.color,
                    roughness: 0.8,
                    metalness: 0.1
                });
                
                const building = new THREE.Mesh(geometry, material);
                building.castShadow = true;
                building.receiveShadow = true;
                building.position.copy(data.position);
                building.rotation.y = data.rotation || 0;
                
                scene.add(building);
                placedBuildings.push(building);
            }
            break;
            
        case 'gameEnded':
            // Game ended by host
            alert(data.message || 'Game ended - returning to lobby');
            location.reload();
            break;
    }
}

function checkGameEndCondition() {
    if (!gameInProgress || !isHost) return;
    
    // Count alive players and real players
    let alivePlayers = 0;
    let aliveRealPlayers = 0;
    let totalRealPlayers = 0;
    
    players.forEach(p => {
        if (!p.isBot) {
            totalRealPlayers++;
            if (p.health > 0) {
                aliveRealPlayers++;
            }
        }
        if (p.health > 0) {
            alivePlayers++;
        }
    });
    
    // End game if no real players remain (only bots)
    if (totalRealPlayers === 0) {
        endGameAndShutdown('No players remaining - only bots left!');
        return;
    }
    
    // End game if no real players are alive
    if (aliveRealPlayers === 0 && totalRealPlayers > 0) {
        endGameAndShutdown('All players eliminated!');
        return;
    }
    
    // End game if 1 or fewer total players remain alive
    if (alivePlayers <= 1 || players.size <= 1) {
        endGameAndShutdown();
    }
}

function endGameAndShutdown(customMessage = null) {
    if (!isHost || !gameInProgress) return;
    
    gameInProgress = false;
    
    let message;
    
    if (customMessage) {
        message = customMessage;
    } else {
        // Determine winner
        let winner = null;
        players.forEach(p => {
            if (p.health > 0 && !p.isBot) winner = p;
        });
        
        message = winner ? `${winner.name} wins! Game ending...` : 'Game ended - no players remaining';
    }
    
    // Broadcast game end to all players
    broadcast({
        type: 'gameEnded',
        message: message
    });
    
    // Show message locally
    alert(message);
    
    // Clean up and reload
    setTimeout(() => {
        cleanupGame();
        location.reload();
    }, 2000);
}

function addBot() {
    if (!isHost) return;
    
    const botId = 'bot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + ' [BOT]';
    
    const bot = {
        id: botId,
        name: botName,
        position: { x: Math.random() * 40 - 20, y: 0, z: Math.random() * 40 - 20 },
        rotation: 0,
        health: 100,
        isBot: true
    };
    
    players.set(botId, bot);
    updatePlayersList();
    
    // Broadcast bot joined to other players
    broadcast({
        type: 'playerJoined',
        player: bot
    });
}

function removeBot() {
    if (!isHost) return;
    
    // Find and remove the last bot
    let botToRemove = null;
    players.forEach((player, id) => {
        if (player.isBot) {
            botToRemove = id;
        }
    });
    
    if (botToRemove) {
        players.delete(botToRemove);
        updatePlayersList();
        
        // Broadcast bot removal
        broadcast({
            type: 'playerDisconnected',
            id: botToRemove
        });
    }
}

function updatePlayersList() {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        li.className = 'player-item';
        
        const name = document.createElement('span');
        name.textContent = player.name;
        
        if (player.id === myPeerId && isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'host-badge';
            hostBadge.textContent = '👑 Host';
            li.appendChild(hostBadge);
        }
        
        if (player.isBot) {
            const botBadge = document.createElement('span');
            botBadge.className = 'host-badge';
            botBadge.style.background = '#4CAF50';
            botBadge.textContent = '🤖 BOT';
            li.appendChild(botBadge);
        }
        
        li.appendChild(name);
        playersList.appendChild(li);
    });
    
    // Enable start button if host and 2+ players
    if (isHost) {
        const startBtn = document.getElementById('startGameBtn');
        if (players.size >= 1) {  // Allow single player for testing
            startBtn.disabled = false;
            startBtn.textContent = 'Start Game';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = 'Start Game (Need 2+ Players)';
        }
    }
}

function startGame() {
    if (!isHost) return;
    
    // Randomize spawn positions
    players.forEach(p => {
        if (p.id !== myPeerId) {
            p.position = {
                x: Math.random() * 40 - 20,
                y: 0,
                z: Math.random() * 40 - 20
            };
        }
    });
    
    // Broadcast start game
    broadcast({
        type: 'startGame',
        players: Array.from(players.values())
    });
    
    // Start own game
    initGame(Array.from(players.values()));
}

function initGame(playersData) {
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    
    gameInProgress = true;
    
    // Update local players map
    playersData.forEach(p => {
        if (players.has(p.id)) {
            players.get(p.id).position = p.position;
        }
    });
    
    initThreeJS();
    
    playersData.forEach(playerData => {
        if (playerData.id === myPeerId) {
            camera.position.set(playerData.position.x, 1.6, playerData.position.z);
        } else {
            createPlayerMesh(playerData);
        }
    });
    
    updatePlayerCount();
    setupControls();
    createWeaponModels();
    updateWeaponDisplay();
    switchWeapon('rifle');
    animate();
}

function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    
    // Enhanced sky with gradient
    const skyColor = new THREE.Color(0x87CEEB);
    const horizonColor = new THREE.Color(0xB0D4F1);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.003);
    
    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    
    // Renderer with enhanced settings
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('gameScreen').appendChild(renderer.domElement);
    
    // Enhanced lighting setup
    const ambientLight = new THREE.AmbientLight(0xB0D4F1, 0.5);
    scene.add(ambientLight);
    
    // Main directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xFFF8DC, 1.2);
    directionalLight.position.set(100, 150, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.bias = -0.0001;
    scene.add(directionalLight);
    
    // Secondary fill light
    const fillLight = new THREE.DirectionalLight(0x8899DD, 0.3);
    fillLight.position.set(-50, 30, -50);
    scene.add(fillLight);
    
    // Hemisphere light for natural sky/ground lighting
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x4a7c47, 0.4);
    scene.add(hemiLight);
    
    // Enhanced ground with texture-like appearance
    const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
    
    // Add terrain variation
    const vertices = groundGeometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
        vertices[i + 2] = Math.random() * 0.3;
    }
    groundGeometry.attributes.position.needsUpdate = true;
    groundGeometry.computeVertexNormals();
    
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x4a7c47,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: false
    });
    terrain = new THREE.Mesh(groundGeometry, groundMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);
    
    // Add buildings
    createBuildings();
    
    // Add environmental details
    addEnvironmentalDetails();
    
    // Subtle grid (more transparent)
    const gridHelper = new THREE.GridHelper(200, 100, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.1;
    gridHelper.material.transparent = true;
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);
    
    // Window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function createBuildings() {
    const buildingColors = [
        0x606060, 0x707070, 0x808080, 0x656565, 0x5a5a5a,
        0x4a5568, 0x556677, 0x6b7280
    ];
    
    for (let i = 0; i < 20; i++) {
        const width = Math.random() * 6 + 4;
        const height = Math.random() * 15 + 8;
        const depth = Math.random() * 6 + 4;
        
        const geometry = new THREE.BoxGeometry(width, height, depth);
        
        // Enhanced building material with variety
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
            roughness: 0.7,
            metalness: 0.2,
            flatShading: false
        });
        
        const building = new THREE.Mesh(geometry, buildingMaterial);
        
        building.position.x = Math.random() * 100 - 50;
        building.position.y = height / 2;
        building.position.z = Math.random() * 100 - 50;
        
        building.castShadow = true;
        building.receiveShadow = true;
        
        scene.add(building);
        
        // Add rooftop detail for some buildings
        if (Math.random() > 0.5) {
            const roofGeometry = new THREE.BoxGeometry(width + 0.2, 0.5, depth + 0.2);
            const roofMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x3a3a3a,
                roughness: 0.8,
                metalness: 0.3
            });
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.y = height / 2 + 0.25;
            building.add(roof);
        }
        
        // Add windows for taller buildings
        if (height > 10) {
            const windowCount = Math.floor(height / 3);
            for (let j = 0; j < windowCount; j++) {
                const windowGeometry = new THREE.BoxGeometry(width * 0.8, 0.4, 0.1);
                const windowMaterial = new THREE.MeshStandardMaterial({ 
                    color: 0x88aaff,
                    emissive: 0x2244aa,
                    emissiveIntensity: 0.3,
                    roughness: 0.1,
                    metalness: 0.9
                });
                const window = new THREE.Mesh(windowGeometry, windowMaterial);
                window.position.y = -height / 2 + 3 + j * 3;
                window.position.z = depth / 2 + 0.05;
                building.add(window);
            }
        }
    }
    
    // Add some rocks/obstacles
    for (let i = 0; i < 30; i++) {
        const size = Math.random() * 1.5 + 0.5;
        const rockGeometry = new THREE.DodecahedronGeometry(size, 0);
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x666666,
            roughness: 0.95,
            metalness: 0,
            flatShading: true
        });
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        rock.position.x = Math.random() * 150 - 75;
        rock.position.y = size / 2;
        rock.position.z = Math.random() * 150 - 75;
        rock.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        
        scene.add(rock);
    }
}

function createWeaponModels() {
    // Pistol model
    const pistolGroup = new THREE.Group();
    
    // Pistol body
    const pistolBodyGeo = new THREE.BoxGeometry(0.08, 0.15, 0.25);
    const pistolBodyMat = new THREE.MeshStandardMaterial({ 
        color: 0x2a2a2a,
        roughness: 0.4,
        metalness: 0.7
    });
    const pistolBody = new THREE.Mesh(pistolBodyGeo, pistolBodyMat);
    pistolBody.position.z = -0.1;
    pistolGroup.add(pistolBody);
    
    // Pistol barrel
    const barrelGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        roughness: 0.3,
        metalness: 0.8
    });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.2);
    pistolGroup.add(barrel);
    
    // Pistol grip
    const gripGeo = new THREE.BoxGeometry(0.06, 0.12, 0.08);
    const gripMat = new THREE.MeshStandardMaterial({ 
        color: 0x3a2415,
        roughness: 0.8
    });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.08, -0.05);
    pistolGroup.add(grip);
    
    weaponModels.pistol = pistolGroup;
    
    // Rifle model
    const rifleGroup = new THREE.Group();
    
    // Rifle body
    const rifleBodyGeo = new THREE.BoxGeometry(0.1, 0.12, 0.5);
    const rifleBodyMat = new THREE.MeshStandardMaterial({ 
        color: 0x2d3436,
        roughness: 0.5,
        metalness: 0.6
    });
    const rifleBody = new THREE.Mesh(rifleBodyGeo, rifleBodyMat);
    rifleBody.position.z = -0.2;
    rifleGroup.add(rifleBody);
    
    // Rifle barrel
    const rifleBarrelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8);
    const rifleBarrelMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        roughness: 0.3,
        metalness: 0.9
    });
    const rifleBarrel = new THREE.Mesh(rifleBarrelGeo, rifleBarrelMat);
    rifleBarrel.rotation.x = Math.PI / 2;
    rifleBarrel.position.set(0, 0.03, -0.5);
    rifleGroup.add(rifleBarrel);
    
    // Rifle stock
    const stockGeo = new THREE.BoxGeometry(0.08, 0.1, 0.2);
    const stockMat = new THREE.MeshStandardMaterial({ 
        color: 0x3a2415,
        roughness: 0.7
    });
    const stock = new THREE.Mesh(stockGeo, stockMat);
    stock.position.set(0, -0.02, 0.1);
    rifleGroup.add(stock);
    
    // Rifle magazine
    const magGeo = new THREE.BoxGeometry(0.06, 0.15, 0.08);
    const magMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        roughness: 0.6,
        metalness: 0.4
    });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.12, -0.1);
    rifleGroup.add(mag);
    
    // Rifle scope
    const scopeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8);
    const scopeMat = new THREE.MeshStandardMaterial({ 
        color: 0x0a0a0a,
        roughness: 0.2,
        metalness: 0.9
    });
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0, 0.1, -0.2);
    rifleGroup.add(scope);
    
    weaponModels.rifle = rifleGroup;
    
    // Sniper model
    const sniperGroup = new THREE.Group();
    
    // Sniper body
    const sniperBodyGeo = new THREE.BoxGeometry(0.11, 0.13, 0.6);
    const sniperBodyMat = new THREE.MeshStandardMaterial({ 
        color: 0x1e272e,
        roughness: 0.4,
        metalness: 0.7
    });
    const sniperBody = new THREE.Mesh(sniperBodyGeo, sniperBodyMat);
    sniperBody.position.z = -0.25;
    sniperGroup.add(sniperBody);
    
    // Sniper barrel (long)
    const sniperBarrelGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.5, 8);
    const sniperBarrelMat = new THREE.MeshStandardMaterial({ 
        color: 0x0a0a0a,
        roughness: 0.2,
        metalness: 0.95
    });
    const sniperBarrel = new THREE.Mesh(sniperBarrelGeo, sniperBarrelMat);
    sniperBarrel.rotation.x = Math.PI / 2;
    sniperBarrel.position.set(0, 0.03, -0.6);
    sniperGroup.add(sniperBarrel);
    
    // Sniper stock
    const sniperStockGeo = new THREE.BoxGeometry(0.09, 0.12, 0.25);
    const sniperStockMat = new THREE.MeshStandardMaterial({ 
        color: 0x2d1810,
        roughness: 0.8
    });
    const sniperStock = new THREE.Mesh(sniperStockGeo, sniperStockMat);
    sniperStock.position.set(0, -0.03, 0.15);
    sniperGroup.add(sniperStock);
    
    // Sniper scope (larger)
    const sniperScopeGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.25, 8);
    const sniperScopeMat = new THREE.MeshStandardMaterial({ 
        color: 0x0f0f0f,
        roughness: 0.1,
        metalness: 0.95
    });
    const sniperScope = new THREE.Mesh(sniperScopeGeo, sniperScopeMat);
    sniperScope.rotation.z = Math.PI / 2;
    sniperScope.position.set(0, 0.12, -0.2);
    sniperGroup.add(sniperScope);
    
    // Scope lens (glowing)
    const lensGeo = new THREE.CircleGeometry(0.035, 16);
    const lensMat = new THREE.MeshBasicMaterial({ 
        color: 0x4488ff,
        transparent: true,
        opacity: 0.6
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.y = Math.PI / 2;
    lens.position.set(-0.13, 0.12, -0.2);
    sniperGroup.add(lens);
    
    // Bipod
    const bipodLegGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6);
    const bipodMat = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.5,
        metalness: 0.8
    });
    const bipodLeft = new THREE.Mesh(bipodLegGeo, bipodMat);
    bipodLeft.position.set(-0.05, -0.1, -0.4);
    bipodLeft.rotation.z = Math.PI / 6;
    sniperGroup.add(bipodLeft);
    
    const bipodRight = new THREE.Mesh(bipodLegGeo, bipodMat);
    bipodRight.position.set(0.05, -0.1, -0.4);
    bipodRight.rotation.z = -Math.PI / 6;
    sniperGroup.add(bipodRight);
    
    weaponModels.sniper = sniperGroup;
}

function updateFirstPersonWeapon() {
    // Remove current weapon
    if (currentWeaponMesh) {
        camera.remove(currentWeaponMesh);
    }
    
    // Add new weapon model
    if (weaponModels[currentWeapon]) {
        currentWeaponMesh = weaponModels[currentWeapon].clone();
        
        // Position weapon in front of camera
        if (currentWeapon === 'pistol') {
            currentWeaponMesh.position.set(0.15, -0.15, -0.3);
            currentWeaponMesh.rotation.set(0, Math.PI, 0);
        } else if (currentWeapon === 'rifle') {
            currentWeaponMesh.position.set(0.2, -0.2, -0.4);
            currentWeaponMesh.rotation.set(0, Math.PI - 0.1, 0);
        } else if (currentWeapon === 'sniper') {
            currentWeaponMesh.position.set(0.15, -0.2, -0.5);
            currentWeaponMesh.rotation.set(0, Math.PI - 0.05, 0);
        }
        
        camera.add(currentWeaponMesh);
    }
}

function addEnvironmentalDetails() {
    // Add trees
    for (let i = 0; i < 40; i++) {
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.4, 3, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4a3520,
            roughness: 0.9
        });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        
        const foliageGeometry = new THREE.ConeGeometry(2, 4, 8);
        const foliageMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2d5016,
            roughness: 0.8
        });
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = 3.5;
        
        trunk.add(foliage);
        
        trunk.position.x = Math.random() * 180 - 90;
        trunk.position.y = 1.5;
        trunk.position.z = Math.random() * 180 - 90;
        
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        foliage.castShadow = true;
        
        scene.add(trunk);
    }
    
    // Add scattered small details (bushes)
    for (let i = 0; i < 50; i++) {
        const bushGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const bushMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x3a5a2a,
            roughness: 0.9
        });
        const bush = new THREE.Mesh(bushGeometry, bushMaterial);
        
        bush.position.x = Math.random() * 180 - 90;
        bush.position.y = 0.3;
        bush.position.z = Math.random() * 180 - 90;
        bush.scale.set(1, 0.7, 1);
        
        bush.castShadow = true;
        bush.receiveShadow = true;
        
        scene.add(bush);
    }
}

function createPlayerMesh(playerData) {
    const playerGroup = new THREE.Group();
    
    // Body with gradient color
    const bodyGeometry = new THREE.BoxGeometry(0.6, 1.0, 0.4);
    const playerColor = new THREE.Color().setHSL(Math.random(), 0.7, 0.5);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
        color: playerColor,
        roughness: 0.6,
        metalness: 0.3
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    playerGroup.add(body);
    
    // Head
    const headGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const headMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffdbac,
        roughness: 0.7,
        metalness: 0.1
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.25;
    head.castShadow = true;
    head.receiveShadow = true;
    playerGroup.add(head);
    
    // Legs
    const legGeometry = new THREE.BoxGeometry(0.25, 0.6, 0.25);
    const legMaterial = new THREE.MeshStandardMaterial({ 
        color: playerColor.clone().multiplyScalar(0.7),
        roughness: 0.7,
        metalness: 0.2
    });
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.15, -0.3, 0);
    leftLeg.castShadow = true;
    playerGroup.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.15, -0.3, 0);
    rightLeg.castShadow = true;
    playerGroup.add(rightLeg);
    
    // Weapon indicator
    const weaponGeometry = new THREE.BoxGeometry(0.15, 0.8, 0.15);
    const weaponMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.4,
        metalness: 0.6
    });
    const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
    weapon.position.set(0.4, 0.5, 0);
    weapon.rotation.z = Math.PI / 4;
    weapon.castShadow = true;
    playerGroup.add(weapon);
    
    playerGroup.position.set(playerData.position.x, 0.9, playerData.position.z);
    scene.add(playerGroup);
    
    // Enhanced name tag with glow
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;
    
    // Draw shadow/glow
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = 10;
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;
    
    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect = function(x, y, w, h, r) {
        this.beginPath();
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r);
        this.lineTo(x + w, y + h - r);
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.lineTo(x + r, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r);
        this.lineTo(x, y + r);
        this.quadraticCurveTo(x, y, x + r, y);
        this.closePath();
        this.fill();
    };
    context.roundRect(50, 20, 412, 88, 15);
    
    // Text
    context.font = 'bold 48px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(playerData.name, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.y = 1.2;
    sprite.scale.set(3, 0.75, 1);
    playerGroup.add(sprite);
    
    const player = players.get(playerData.id);
    if (player) {
        player.mesh = playerGroup;
        player.targetPosition = playerData.position;
        player.targetRotation = playerData.rotation;
    }
}

function setupControls() {
    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        
        // ESC to toggle menu
        if (e.key === 'Escape') {
            toggleMenu();
            e.preventDefault();
        }
        
        // Only process game controls if menu is closed and pointer is locked
        if (!isMenuOpen && isPointerLocked) {
            // Jump
            if (key === ' ' && !isJumping) {
                isJumping = true;
                verticalVelocity = JUMP_FORCE;
            }
            
            // Toggle build mode
            if (key === 'g') {
                buildMode = !buildMode;
                updateBuildPreview();
                updateHUD();
                
                // Update crosshair appearance
                const crosshair = document.querySelector('.crosshair');
                if (crosshair) {
                    if (buildMode) {
                        crosshair.classList.add('build-mode');
                    } else {
                        crosshair.classList.remove('build-mode');
                    }
                }
            }
            
            // Building piece selection (only in build mode)
            if (buildMode) {
                if (key === 'q') {
                    currentBuildPiece = 'wall';
                    updateBuildPreview();
                }
                if (key === 'e') {
                    currentBuildPiece = 'floor';
                    updateBuildPreview();
                }
                if (key === 'f') {
                    currentBuildPiece = 'ramp';
                    updateBuildPreview();
                }
                // Rotate building
                if (key === 'r') {
                    buildRotation = (buildRotation + 90) % 360;
                    updateBuildPreview();
                }
            }
            
            // Weapon switching (only when not in build mode)
            if (!buildMode) {
                if (key === '1') switchWeapon('pistol');
                if (key === '2') switchWeapon('rifle');
                if (key === '3') switchWeapon('sniper');
            }
            
            // Reload
            if (key === 'r') reload();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });
    
    document.addEventListener('click', () => {
        if (!isPointerLocked && !isMenuOpen) {
            document.body.requestPointerLock();
        }
    });
    
    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === document.body;
        if (!isPointerLocked && !isMenuOpen) {
            // Pointer lock was lost, open menu
            openMenu();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isPointerLocked && !isMenuOpen) {
            // Minecraft-style camera rotation
            const sensitivity = 0.002;
            cameraRotation.yaw -= e.movementX * sensitivity;
            cameraRotation.pitch -= e.movementY * sensitivity;
            
            // Clamp pitch to prevent flipping
            cameraRotation.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotation.pitch));
        }
    });
    
    document.addEventListener('mousedown', (e) => {
        if (e.button === 0 && isPointerLocked && !isMenuOpen) {
            if (buildMode) {
                placeBuilding();
            } else {
                shoot();
            }
        }
    });
}

function toggleMenu() {
    if (isMenuOpen) {
        closeMenu();
    } else {
        openMenu();
    }
}

function openMenu() {
    isMenuOpen = true;
    document.getElementById('gameMenu').style.display = 'flex';
    document.exitPointerLock();
}

function closeMenu() {
    isMenuOpen = false;
    document.getElementById('gameMenu').style.display = 'none';
    document.body.requestPointerLock();
}

function returnToLobby() {
    // Disconnect from all peers
    connections.forEach(conn => conn.close());
    connections.clear();
    if (peer) {
        peer.destroy();
    }
    
    // Clear players
    players.forEach((player, id) => {
        if (player.mesh && id !== myPeerId) {
            scene.remove(player.mesh);
        }
    });
    players.clear();
    
    isMenuOpen = false;
    isPointerLocked = false;
    
    location.reload(); // Simplest way to fully reset
}

function switchWeapon(weaponName) {
    if (WEAPONS[weaponName] && !isReloading) {
        currentWeapon = weaponName;
        ammo = WEAPONS[weaponName].maxAmmo;
        updateWeaponDisplay();
        updateFirstPersonWeapon();
    }
}

function reload() {
    if (isReloading || ammo === WEAPONS[currentWeapon].maxAmmo) return;
    
    isReloading = true;
    updateWeaponDisplay();
    
    setTimeout(() => {
        ammo = WEAPONS[currentWeapon].maxAmmo;
        isReloading = false;
        updateWeaponDisplay();
    }, WEAPONS[currentWeapon].reloadTime);
}

function updateWeaponDisplay() {
    const weaponNameEl = document.getElementById('weaponName');
    const ammoEl = document.getElementById('ammoCount');
    
    if (weaponNameEl) {
        weaponNameEl.textContent = WEAPONS[currentWeapon].name;
    }
    
    if (ammoEl) {
        if (isReloading) {
            ammoEl.textContent = 'RELOADING...';
        } else {
            ammoEl.textContent = `${ammo} / ${WEAPONS[currentWeapon].maxAmmo}`;
        }
    }
}

function shoot() {
    const weapon = WEAPONS[currentWeapon];
    const now = Date.now();
    
    // Check fire rate, ammo, health, and reload status
    if (now - lastShootTime < weapon.fireRate) return;
    if (isReloading || ammo <= 0 || myPlayer.health <= 0) return;
    
    lastShootTime = now;
    ammo--;
    updateWeaponDisplay();
    
    // Weapon recoil animation
    if (currentWeaponMesh) {
        const originalPos = currentWeaponMesh.position.clone();
        const recoilAmount = currentWeapon === 'sniper' ? 0.15 : (currentWeapon === 'rifle' ? 0.08 : 0.05);
        currentWeaponMesh.position.z += recoilAmount;
        currentWeaponMesh.rotation.x -= recoilAmount * 0.5;
        
        setTimeout(() => {
            if (currentWeaponMesh) {
                currentWeaponMesh.position.copy(originalPos);
                currentWeaponMesh.rotation.x = 0;
            }
        }, 100);
    }
    
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    // Create muzzle flash
    createMuzzleFlash();
    
    // Create bullet trail with weapon-specific color and width
    createBulletTrail(camera.position, direction, weapon.color, weapon.trailWidth);
    
    // Broadcast shoot
    broadcast({
        type: 'playerShoot',
        id: myPeerId,
        direction: direction,
        weapon: currentWeapon
    });
    
    // Raycast for hits with weapon range
    const raycaster = new THREE.Raycaster();
    raycaster.set(camera.position, direction);
    raycaster.far = weapon.range;
    
    const playerMeshes = [];
    players.forEach((p, id) => {
        if (id !== myPeerId && p.mesh) {
            playerMeshes.push({ mesh: p.mesh, id: id });
        }
    });
    
    const intersects = raycaster.intersectObjects(playerMeshes.map(p => p.mesh), true);
    
    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        for (const pm of playerMeshes) {
            if (pm.mesh === hitMesh || pm.mesh.children.includes(hitMesh)) {
                // Hit someone with weapon-specific damage!
                const hitPlayer = players.get(pm.id);
                if (hitPlayer) {
                    hitPlayer.health = (hitPlayer.health || 100) - weapon.damage;
                    
                    // Broadcast hit
                    broadcast({
                        type: 'playerHit',
                        id: myPeerId,
                        targetId: pm.id,
                        damage: weapon.damage
                    });
                    
                    // Handle death
                    if (hitPlayer.health <= 0) {
                        hitPlayer.health = 0;
                        if (hitPlayer.mesh) {
                            hitPlayer.mesh.visible = false;
                        }
                        
                        // Show kill feed
                        addKillFeedMessage(myPeerId, pm.id);
                        
                        // If it's a bot, respawn after delay
                        if (hitPlayer.isBot) {
                            setTimeout(() => {
                                hitPlayer.health = 100;
                                hitPlayer.position = {
                                    x: Math.random() * 40 - 20,
                                    y: 0,
                                    z: Math.random() * 40 - 20
                                };
                                if (hitPlayer.mesh) {
                                    hitPlayer.mesh.visible = true;
                                    hitPlayer.mesh.position.set(hitPlayer.position.x, 0.9, hitPlayer.position.z);
                                }
                                broadcast({
                                    type: 'playerRespawned',
                                    id: pm.id,
                                    position: hitPlayer.position
                                });
                            }, 3000);
                        }
                    }
                }
                break;
            }
        }
    }
    
    // Auto-reload when empty
    if (ammo === 0) {
        reload();
    }
}

function createMuzzleFlash() {
    const weapon = WEAPONS[currentWeapon];
    
    // Outer flash
    const flashGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const flashMaterial = new THREE.MeshBasicMaterial({ 
        color: weapon.color,
        transparent: true,
        opacity: 0.9
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    
    // Inner bright core
    const coreGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const coreMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 1
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    flash.add(core);
    
    // Position in front of camera
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    flash.position.copy(camera.position).add(direction.multiplyScalar(0.5));
    
    // Add point light for muzzle flash illumination
    const flashLight = new THREE.PointLight(weapon.color, 2, 10);
    flashLight.position.copy(flash.position);
    scene.add(flashLight);
    
    scene.add(flash);
    
    setTimeout(() => {
        scene.remove(flash);
        scene.remove(flashLight);
    }, 50);
}

function createBulletTrail(startPos, direction, color = 0xffff00, width = 1) {
    const weapon = WEAPONS[currentWeapon];
    const endPos = startPos.clone().add(direction.clone().multiplyScalar(weapon.range));
    
    // Main bullet trail
    const points = [startPos.clone(), endPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
        color: color,
        linewidth: width,
        transparent: true,
        opacity: 0.8
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    
    // Add glowing effect trail
    const glowMaterial = new THREE.LineBasicMaterial({ 
        color: color,
        linewidth: width * 2,
        transparent: true,
        opacity: 0.3
    });
    const glowLine = new THREE.Line(geometry.clone(), glowMaterial);
    scene.add(glowLine);
    
    // Create impact particles at endpoint
    createImpactEffect(endPos, color);
    
    setTimeout(() => {
        scene.remove(line);
        scene.remove(glowLine);
    }, 100);
}

function updateBuildPreview() {
    // Remove existing preview
    if (buildPreview) {
        scene.remove(buildPreview);
        buildPreview = null;
    }
    
    if (!buildMode || !scene || !camera) return;
    
    // Calculate placement position - centered in front of camera
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);
    const placePos = camera.position.clone().add(direction.multiplyScalar(BUILD_DISTANCE));
    
    // Snap to grid (3x3 units)
    placePos.y = Math.floor(placePos.y / 3) * 3;
    placePos.x = Math.round(placePos.x / 3) * 3;
    placePos.z = Math.round(placePos.z / 3) * 3;
    
    // Create preview mesh
    const piece = BUILD_PIECES[currentBuildPiece];
    let geometry;
    
    if (currentBuildPiece === 'ramp') {
        // Create ramp geometry
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(3, 0);
        shape.lineTo(3, 3);
        shape.lineTo(0, 0);
        
        const extrudeSettings = { depth: 3, bevelEnabled: false };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    } else {
        geometry = new THREE.BoxGeometry(piece.width, piece.height, piece.depth);
    }
    
    const material = new THREE.MeshStandardMaterial({ 
        color: materials >= BUILD_COST[currentBuildPiece] ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.5
    });
    
    buildPreview = new THREE.Mesh(geometry, material);
    
    // Position based on piece type
    if (currentBuildPiece === 'wall') {
        buildPreview.position.set(placePos.x, placePos.y + 1.5, placePos.z);
    } else if (currentBuildPiece === 'floor') {
        buildPreview.position.set(placePos.x, placePos.y, placePos.z);
    } else if (currentBuildPiece === 'ramp') {
        buildPreview.position.set(placePos.x, placePos.y, placePos.z);
    }
    
    // Apply rotation
    const rotationRadians = (buildRotation * Math.PI) / 180;
    buildPreview.rotation.y = rotationRadians;
    
    scene.add(buildPreview);
}

function placeBuilding() {
    if (!buildMode || materials < BUILD_COST[currentBuildPiece]) return;
    
    // Calculate placement position - centered in front of camera
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);
    const placePos = camera.position.clone().add(direction.multiplyScalar(BUILD_DISTANCE));
    
    // Snap to grid
    placePos.y = Math.floor(placePos.y / 3) * 3;
    placePos.x = Math.round(placePos.x / 3) * 3;
    placePos.z = Math.round(placePos.z / 3) * 3;
    
    // Create building piece
    const piece = BUILD_PIECES[currentBuildPiece];
    let geometry;
    
    if (currentBuildPiece === 'ramp') {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(3, 0);
        shape.lineTo(3, 3);
        shape.lineTo(0, 0);
        
        const extrudeSettings = { depth: 3, bevelEnabled: false };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    } else {
        geometry = new THREE.BoxGeometry(piece.width, piece.height, piece.depth);
    }
    
    const material = new THREE.MeshStandardMaterial({ 
        color: piece.color,
        roughness: 0.8,
        metalness: 0.1
    });
    
    const building = new THREE.Mesh(geometry, material);
    building.castShadow = true;
    building.receiveShadow = true;
    
    // Position based on piece type
    if (currentBuildPiece === 'wall') {
        building.position.set(placePos.x, placePos.y + 1.5, placePos.z);
    } else if (currentBuildPiece === 'floor') {
        building.position.set(placePos.x, placePos.y, placePos.z);
    } else if (currentBuildPiece === 'ramp') {
        building.position.set(placePos.x, placePos.y, placePos.z);
    }
    
    // Apply rotation
    const rotationRadians = (buildRotation * Math.PI) / 180;
    building.rotation.y = rotationRadians;
    
    scene.add(building);
    placedBuildings.push(building);
    
    // Deduct materials
    materials -= BUILD_COST[currentBuildPiece];
    updateHUD();
    
    // Broadcast building placement
    broadcast({
        type: 'buildingPlaced',
        piece: currentBuildPiece,
        position: building.position,
        rotation: building.rotation.y
    });
}

function updateHUD() {
    // Update materials display
    const materialsEl = document.getElementById('materialsCount');
    if (materialsEl) {
        materialsEl.textContent = materials;
    }
    
    // Update build mode indicator
    const buildModeEl = document.getElementById('buildModeIndicator');
    if (buildModeEl) {
        buildModeEl.style.display = buildMode ? 'block' : 'none';
        if (buildMode) {
            buildModeEl.textContent = `Building: ${currentBuildPiece.toUpperCase()} (${BUILD_COST[currentBuildPiece]} wood) | Rotation: ${buildRotation}°`;
        }
    }
}

function updateBots() {
    players.forEach((bot, botId) => {
        if (!bot.isBot || !bot.mesh || bot.health <= 0) return;
        
        // Bot AI behavior
        const now = Date.now();
        if (!bot.lastAIUpdate) bot.lastAIUpdate = now;
        if (!bot.targetPosition) bot.targetPosition = { ...bot.position };
        if (!bot.aiState) bot.aiState = 'roam';
        if (!bot.lastShot) bot.lastShot = 0;
        
        // Update AI every 500ms
        if (now - bot.lastAIUpdate > 500) {
            bot.lastAIUpdate = now;
            
            // Find nearest player
            let nearestPlayer = null;
            let nearestDistance = Infinity;
            
            players.forEach((player, playerId) => {
                if (playerId !== botId && !player.isBot && player.health > 0) {
                    const dist = Math.sqrt(
                        Math.pow(player.position.x - bot.position.x, 2) +
                        Math.pow(player.position.z - bot.position.z, 2)
                    );
                    if (dist < nearestDistance) {
                        nearestDistance = dist;
                        nearestPlayer = player;
                    }
                }
            });
            
            // Bot behavior based on distance to nearest player
            if (nearestPlayer && nearestDistance < 30) {
                // Combat mode - move towards player
                bot.aiState = 'combat';
                const angle = Math.atan2(
                    nearestPlayer.position.x - bot.position.x,
                    nearestPlayer.position.z - bot.position.z
                );
                
                // Move towards player (slower, more natural)
                const moveSpeed = 0.05;
                bot.position.x += Math.sin(angle) * moveSpeed;
                bot.position.z += Math.cos(angle) * moveSpeed;
                bot.rotation = angle;
                
                // Shoot at player if in range
                if (nearestDistance < 20 && now - bot.lastShot > 800) {
                    bot.lastShot = now;
                    botShoot(bot, nearestPlayer);
                }
            } else {
                // Roam mode - random movement
                bot.aiState = 'roam';
                if (Math.random() < 0.2) {
                    bot.targetPosition = {
                        x: bot.position.x + (Math.random() - 0.5) * 15,
                        y: 0,
                        z: bot.position.z + (Math.random() - 0.5) * 15
                    };
                }
                
                // Move towards target position
                const dx = bot.targetPosition.x - bot.position.x;
                const dz = bot.targetPosition.z - bot.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                
                if (dist > 1.0) {
                    const moveSpeed = 0.04;
                    bot.position.x += (dx / dist) * moveSpeed;
                    bot.position.z += (dz / dist) * moveSpeed;
                    bot.rotation = Math.atan2(dx, dz);
                }
            }
        }
        
        // Smooth mesh position update
        if (bot.mesh) {
            const lerpFactor = 0.1;
            bot.mesh.position.x += (bot.position.x - bot.mesh.position.x) * lerpFactor;
            bot.mesh.position.z += (bot.position.z - bot.mesh.position.z) * lerpFactor;
            bot.mesh.position.y = 0.9; // Keep at ground level
            
            // Smooth rotation
            let targetRotation = bot.rotation;
            let currentRotation = bot.mesh.rotation.y;
            
            // Handle rotation wrapping
            let rotDiff = targetRotation - currentRotation;
            while (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
            while (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
            
            bot.mesh.rotation.y += rotDiff * 0.1;
        }
        
        // Broadcast bot movement to all players (less frequently)
        if (now - (bot.lastBroadcast || 0) > 100) {
            bot.lastBroadcast = now;
            broadcast({
                type: 'playerMove',
                id: botId,
                position: bot.position,
                rotation: bot.rotation
            });
        }
    });
}

function botShoot(bot, targetPlayer) {
    if (!targetPlayer || targetPlayer.health <= 0) return;
    
    // Calculate direction to target
    const direction = new THREE.Vector3(
        targetPlayer.position.x - bot.position.x,
        0,
        targetPlayer.position.z - bot.position.z
    ).normalize();
    
    // Bot accuracy (70% chance to hit)
    const accuracy = 0.7;
    const damage = 15;
    
    // Visual effect
    if (bot.mesh && scene) {
        createBulletTrail(
            new THREE.Vector3(bot.position.x, 0.9, bot.position.z),
            direction,
            0xffff00,
            1
        );
    }
    
    // Broadcast bot shot
    broadcast({
        type: 'playerShoot',
        id: bot.id,
        direction: direction,
        weapon: 'pistol'
    });
    
    // Hit detection
    if (Math.random() < accuracy) {
        // Hit the target
        if (targetPlayer.id === myPeerId) {
            // Bot hit me
            myPlayer.health -= damage;
            updateHealth(myPlayer.health);
            
            if (myPlayer.health <= 0) {
                myPlayer.health = 0;
                showEliminatedScreen(bot.id);
                
                // Respawn after 3 seconds
                setTimeout(() => {
                    myPlayer.health = 100;
                    myPlayer.position = {
                        x: Math.random() * 40 - 20,
                        y: 0,
                        z: Math.random() * 40 - 20
                    };
                    camera.position.set(myPlayer.position.x, GROUND_LEVEL, myPlayer.position.z);
                    hideEliminatedScreen();
                    updateHealth(100);
                    
                    broadcast({
                        type: 'playerRespawned',
                        id: myPeerId,
                        position: myPlayer.position
                    });
                }, 3000);
            }
        }
        
        // Broadcast hit
        broadcast({
            type: 'playerHit',
            id: bot.id,
            targetId: targetPlayer.id,
            damage: damage
        });
        
        addKillFeedMessage(bot.id, targetPlayer.id);
    }
}

function createImpactEffect(position, color) {
    // Create spark particles
    for (let i = 0; i < 8; i++) {
        const sparkGeometry = new THREE.SphereGeometry(0.05, 4, 4);
        const sparkMaterial = new THREE.MeshBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: 1
        });
        const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
        
        spark.position.copy(position);
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(0.5);
        
        scene.add(spark);
        
        // Animate spark
        let life = 0;
        const animateSpark = () => {
            life += 0.05;
            if (life < 1) {
                spark.position.add(velocity.clone().multiplyScalar(0.1));
                spark.material.opacity = 1 - life;
                spark.scale.multiplyScalar(0.95);
                requestAnimationFrame(animateSpark);
            } else {
                scene.remove(spark);
            }
        };
        animateSpark();
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    // Apply Minecraft-style camera rotation
    if (!isMenuOpen) {
        camera.rotation.order = 'YXZ';
        camera.rotation.y = cameraRotation.yaw;
        camera.rotation.x = cameraRotation.pitch;
    }
    
    // Movement (only if not in menu)
    if (!isMenuOpen) {
        const moveDirection = new THREE.Vector3();
        
        if (keys['w']) moveDirection.z -= 1;
        if (keys['s']) moveDirection.z += 1;
        if (keys['a']) moveDirection.x -= 1;
        if (keys['d']) moveDirection.x += 1;
        
        if (moveDirection.length() > 0) {
            moveDirection.normalize();
            
            // Rotate movement based on camera yaw only (not pitch)
            const yawRotation = new THREE.Euler(0, cameraRotation.yaw, 0, 'YXZ');
            moveDirection.applyEuler(yawRotation);
            
            camera.position.add(moveDirection.multiplyScalar(MOVE_SPEED));
            
            myPlayer.position = { x: camera.position.x, y: 0, z: camera.position.z };
            myPlayer.rotation = cameraRotation.yaw;
            
            // Broadcast position
            broadcast({
                type: 'playerMove',
                id: myPeerId,
                position: myPlayer.position,
                rotation: myPlayer.rotation
            });
        }
        
        // Jump physics
        if (isJumping) {
            verticalVelocity -= GRAVITY;
            camera.position.y += verticalVelocity;
            
            // Check if landed
            if (camera.position.y <= GROUND_LEVEL) {
                camera.position.y = GROUND_LEVEL;
                isJumping = false;
                verticalVelocity = 0;
            }
        } else {
            camera.position.y = GROUND_LEVEL;
        }
    }
    
    // Update bots AI
    if (isHost && gameInProgress) {
        updateBots();
    }
    
    // Update build preview
    if (buildMode && !isMenuOpen) {
        updateBuildPreview();
    }
    
    // Update other players
    players.forEach((player, id) => {
        if (id !== myPeerId && player.mesh && player.targetPosition) {
            player.mesh.position.x += (player.targetPosition.x - player.mesh.position.x + 0.5) * 0.2;
            player.mesh.position.z += (player.targetPosition.z - player.mesh.position.z + 0.5) * 0.2;
            player.mesh.rotation.y = player.targetRotation || 0;
        }
    });
    
    renderer.render(scene, camera);
}

function broadcast(message) {
    connections.forEach(conn => {
        if (conn.open) {
            conn.send(message);
        }
    });
}

function broadcastToOthers(message, excludeId) {
    connections.forEach((conn, id) => {
        if (conn.open && id !== excludeId) {
            conn.send(message);
        }
    });
}

function updateHealth(health) {
    document.getElementById('healthBar').style.width = health + '%';
    document.getElementById('healthText').textContent = health;
    
    if (health <= 30) {
        document.getElementById('healthBar').style.backgroundColor = '#f44336';
    } else if (health <= 60) {
        document.getElementById('healthBar').style.backgroundColor = '#ff9800';
    } else {
        document.getElementById('healthBar').style.backgroundColor = '#4CAF50';
    }
}

function showEliminatedScreen(killerId) {
    const killer = players.get(killerId);
    document.getElementById('eliminatedText').textContent = 
        `You were eliminated by ${killer ? killer.name : 'someone'}`;
    document.getElementById('eliminatedScreen').style.display = 'flex';
    
    let timer = 3;
    const interval = setInterval(() => {
        timer--;
        document.getElementById('respawnTimer').textContent = timer;
        if (timer <= 0) {
            clearInterval(interval);
        }
    }, 1000);
}

function hideEliminatedScreen() {
    document.getElementById('eliminatedScreen').style.display = 'none';
}

function addKillFeedMessage(killerId, victimId, isDisconnect = false) {
    const killer = players.get(killerId) || { name: 'Unknown' };
    const victim = players.get(victimId) || { name: 'Player' };
    
    const killFeed = document.getElementById('killFeed');
    const message = document.createElement('div');
    message.className = 'kill-message';
    
    if (isDisconnect) {
        message.textContent = `${victim.name} disconnected`;
        message.style.background = 'rgba(100, 100, 100, 0.8)';
    } else if (victimId === myPeerId) {
        message.textContent = `${killer.name} eliminated You`;
    } else if (killerId === myPeerId) {
        message.textContent = `You eliminated ${victim.name}`;
    } else {
        message.textContent = `${killer.name} eliminated ${victim.name}`;
    }
    
    killFeed.appendChild(message);
    
    setTimeout(() => {
        message.remove();
    }, 5000);
}

function updatePlayerCount() {
    document.getElementById('playerCount').textContent = `Players: ${players.size}`;
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    const successEl = document.getElementById('statusMessage');
    successEl.textContent = message;
    successEl.style.display = 'block';
    setTimeout(() => {
        successEl.style.display = 'none';
    }, 5000);
}

function showStatus(message) {
    const successEl = document.getElementById('statusMessage');
    successEl.textContent = message;
    successEl.style.display = 'block';
}
