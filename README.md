# 🎮 Battle Royale 3D - Chromebook Edition

A fully browser-based 3D multiplayer battle royale game that works on **any Chromebook** with **zero installation required**!

## ✨ Features

- 🌐 **100% Browser-Based** - No downloads, no installation, no server setup
- 🎮 **Real Multiplayer** - Peer-to-peer connections using WebRTC
- 🌐 **Public & Private Lobbies** - Browse public games or create private ones
- 🔍 **Matchmaking** - Find and join public games instantly
- 🏃 **Full 3D Graphics** - Powered by Three.js
- 🎯 **Combat System** - Shooting with hit detection
- 💚 **Health & Respawn** - Get eliminated? Respawn in 3 seconds
- 🏢 **3D Environment** - Buildings and obstacles to explore
- 📊 **Live Kill Feed** - See eliminations in real-time

## 🚀 How to Play

### Step 1: Open the Game
1. Download or copy the `chromebook-game` folder to your Chromebook
2. Open the `index.html` file in Chrome (right-click → Open with → Chrome)

**OR** simply double-click `index.html`!

### Step 2: Host or Join

**Option A: Host a Public Game**
1. Enter your name
2. Select "🌐 Public" lobby type
3. Click "Host Game"
4. Your game will appear in Browse Public Games for anyone to join!

**Option B: Host a Private Game**
1. Enter your name
2. Select "🔒 Private" lobby type
3. Click "Host Game"
4. Share your **Game ID** with specific friends

**Option C: Browse Public Games**
1. Enter your name
2. Click "Browse Public Games"
3. See all available public games
4. Click any game to join instantly!

**Option D: Join a Private Game**
1. Get the Game ID from your friend
2. Enter your name
3. Paste the Game ID
4. Click "Join Private Game"

### Step 3: Start Playing
- **Host:** Click "Start Game" when everyone has joined
- Everyone will spawn into the 3D world!

## 🎯 Game Controls

| Control | Action |
|---------|--------|
| **W** | Move forward |
| **A** | Move left |
| **S** | Move backward |
| **D** | Move right |
| **Mouse** | Look around (click anywhere first to lock mouse) |
| **Left Click** | Shoot |
| **ESC** | Release mouse / exit pointer lock |

## 💡 How It Works

### Multiplayer (P2P)
This game uses **PeerJS** for peer-to-peer (P2P) connections:
- No game server needed on your computer
- Uses a free public signaling server (PeerJS Cloud)
- Direct connections between players
- Works on school Chromebooks (no blocked ports!)

### Public Lobbies (Optional)
For public game matchmaking, we use a simple API:
- Hosted on Vercel (free)
- Tracks which games are available
- See `VERCEL_DEPLOY.md` for setup instructions
- **Private games work without any server!**

## 🌐 Playing with Friends

### Public Games (If matchmaking server is deployed)
1. Host creates a **Public** game
2. Friends click "Browse Public Games"
3. They see your game and click to join - no Game ID needed!

### Private Games (Works always, even without server)
1. Host creates a **Private** game
2. Host shares the Game ID (copy and send via text/Discord/etc.)
3. Friends paste the Game ID and join

### On the Same Network (WiFi)
Both methods work great on the same WiFi!

### Over the Internet
Also works! WebRTC connects players directly, even on different networks.

### Tips for Best Experience:
- Public games require the Vercel matchmaking server (see `VERCEL_DEPLOY.md`)
- Private games work with zero setup
- Make sure you have a stable internet connection
- Chrome browser works best
- Game IDs are unique each session

## 📱 Works On

- ✅ Chromebooks
- ✅ Windows PCs (Chrome/Edge)
- ✅ Mac computers (Chrome/Safari)
- ✅ Linux (Chrome/Firefox)
- ⚠️ Phones/tablets (works but controls are tricky without keyboard/mouse)

## 🔧 No Installation Needed!

Everything loads from the internet:
- **Three.js** - 3D graphics library
- **PeerJS** - P2P networking library

Just internet access + Chrome = Ready to play!

## 🎓 Perfect for School

This game is ideal for school Chromebooks because:
- No downloads required
- No server installation
- No administrator privileges needed
- Works with school WiFi restrictions
- Just open the HTML file and play!

## 🐛 Troubleshooting

**"Connection error" when hosting/joining:**
- Check your internet connection
- Try refreshing the page and creating a new lobby
- Make sure both players are using the exact same Game ID

**Can't see my friend in the game:**
- Verify they successfully joined the lobby before you started
- Make sure the host clicked "Start Game"

**Mouse won't lock:**
- Click anywhere on the game screen first
- Press ESC to unlock, then click again to re-lock

**Game is laggy:**
- Close other tabs/programs
- Check your internet connection
- Try refreshing the page

## 🎮 Game Tips

1. **Stay in Cover** - Use buildings to hide from enemies
2. **Keep Moving** - Don't stand still or you're an easy target
3. **Watch Your Health** - It's displayed in the top-left corner
4. **Use the Kill Feed** - See who's eliminating who on the right side
5. **Practice Aiming** - The crosshair in the center shows where you'll shoot

## 📝 Technical Details

- **3D Engine:** Three.js (r128)
- **Networking:** PeerJS 1.5.0 (WebRTC)
- **Architecture:** Peer-to-peer mesh network
- **Languages:** HTML5, CSS3, JavaScript
- **Server Required:** None! (Uses free PeerJS cloud for signaling)

## 🎉 Share & Play!

To share with friends:
1. Send them the `chromebook-game` folder (or just `index.html` and `game.js`)
2. They open `index.html` in their browser
3. Share your Game ID with them
4. Start playing!

You can also put these files on a USB drive, Google Drive, or any file hosting service!

## 🌟 Future Ideas

Want to make it better? Here are some ideas:
- Add different weapon types
- Create a bigger map
- Add power-ups and items
- Implement building mechanics (like Fortnite!)
- Add voice chat
- Create teams/squads

## 📄 License

Free to use and modify! Have fun!

---

**Enjoy the game! Happy fragging! 🎮💥**
