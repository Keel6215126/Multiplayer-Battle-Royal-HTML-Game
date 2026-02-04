// Game state
let peer;
let myPeerId;
let connections = new Map();
let players = new Map();
let myPlayer;
let isHost = false;
let isPublicLobby = false;
let gameInProgress = false;

// Matchmaking API URL - UPDATE THIS after deploying to Vercel!
const MATCHMAKING_API = 'https://idk-umber-sigma.vercel.app/api/lobbies';

// Three.js variables
let scene, camera, renderer;
let terrain;
let keys = {};
let isPointerLocked = false;
let isMenuOpen = false;
let cameraRotation = { yaw: 0, pitch: 0 };

// Game constants
const MOVE_SPEED = 0.15;
const ROTATION_SPEED = 0.002;

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
            registerPublicLobby();
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
        players.delete(conn.peer);
        updatePlayersList();
        updatePlayerCount();
        
        // Remove player mesh if game started
        if (disconnectedPlayer && disconnectedPlayer.mesh && scene) {
            scene.remove(disconnectedPlayer.mesh);
        }
        
        // Check if game should end
        if (gameInProgress) {
            checkGameEndCondition();
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
            
        case 'gameEnded':
            // Game ended by host
            alert(data.message || 'Game ended - returning to lobby');
            location.reload();
            break;
    }
}

function checkGameEndCondition() {
    if (!gameInProgress || !isHost) return;
    
    // Count alive players
    let alivePlayers = 0;
    players.forEach(p => {
        if (p.health > 0) alivePlayers++;
    });
    
    // End game if 1 or fewer players remain alive, or 1 or fewer total players
    if (alivePlayers <= 1 || players.size <= 1) {
        endGameAndShutdown();
    }
}

function endGameAndShutdown() {
    if (!isHost || !gameInProgress) return;
    
    gameInProgress = false;
    
    // Determine winner
    let winner = null;
    players.forEach(p => {
        if (p.health > 0) winner = p;
    });
    
    const message = winner ? `${winner.name} wins! Game ending...` : 'Game ended - no players remaining';
    
    // Broadcast game end to all players
    broadcast({
        type: 'gameEnded',
        message: message
    });
    
    // Clean up and reload
    setTimeout(() => {
        cleanupGame();
        location.reload();
    }, 2000);
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
    updateWeaponDisplay();
    animate();
}

function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 0, 200);
    
    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('gameScreen').appendChild(renderer.domElement);
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);
    
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x3d7c47,
        roughness: 0.8
    });
    terrain = new THREE.Mesh(groundGeometry, groundMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);
    
    // Add buildings
    createBuildings();
    
    // Grid
    const gridHelper = new THREE.GridHelper(200, 50, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
    
    // Window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function createBuildings() {
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
    
    for (let i = 0; i < 15; i++) {
        const width = Math.random() * 5 + 3;
        const height = Math.random() * 10 + 5;
        const depth = Math.random() * 5 + 3;
        
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const building = new THREE.Mesh(geometry, buildingMaterial);
        
        building.position.x = Math.random() * 80 - 40;
        building.position.y = height / 2;
        building.position.z = Math.random() * 80 - 40;
        
        building.castShadow = true;
        building.receiveShadow = true;
        
        scene.add(building);
    }
}

function createPlayerMesh(playerData) {
    const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.6);
    const material = new THREE.MeshStandardMaterial({ 
        color: Math.random() * 0xffffff 
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(playerData.position.x, 0.9, playerData.position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    // Name tag
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '24px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.fillText(playerData.name, canvas.width / 2, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.y = 1.5;
    sprite.scale.set(2, 0.5, 1);
    mesh.add(sprite);
    
    const player = players.get(playerData.id);
    if (player) {
        player.mesh = mesh;
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
            // Weapon switching
            if (key === '1') switchWeapon('pistol');
            if (key === '2') switchWeapon('rifle');
            if (key === '3') switchWeapon('sniper');
            
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
            shoot();
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
    
    const intersects = raycaster.intersectObjects(playerMeshes.map(p => p.mesh));
    
    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        for (const pm of playerMeshes) {
            if (pm.mesh === hitMesh) {
                // Hit someone with weapon-specific damage!
                broadcast({
                    type: 'playerHit',
                    id: myPeerId,
                    targetId: pm.id,
                    damage: weapon.damage
                });
                
                const hitPlayer = players.get(pm.id);
                if (hitPlayer) {
                    hitPlayer.health = (hitPlayer.health || 100) - weapon.damage;
                    if (hitPlayer.health <= 0 && hitPlayer.mesh) {
                        hitPlayer.mesh.visible = false;
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
    const flashGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    const flashMaterial = new THREE.MeshBasicMaterial({ 
        color: WEAPONS[currentWeapon].color,
        transparent: true,
        opacity: 0.8
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    
    // Position in front of camera
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    flash.position.copy(camera.position).add(direction.multiplyScalar(0.5));
    
    scene.add(flash);
    
    setTimeout(() => {
        scene.remove(flash);
    }, 50);
}

function createBulletTrail(startPos, direction, color = 0xffff00, width = 1) {
    const weapon = WEAPONS[currentWeapon];
    const endPos = startPos.clone().add(direction.clone().multiplyScalar(weapon.range));
    
    const points = [startPos.clone(), endPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
        color: color,
        linewidth: width
    });
    const line = new THREE.Line(geometry, material);
    
    scene.add(line);
    
    setTimeout(() => {
        scene.remove(line);
    }, 100);
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
            camera.position.y = 1.6;
            
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
