#!/usr/bin/env python3
"""Local matchmaking server for Battle Royale game"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
from datetime import datetime, timedelta
from urllib.parse import urlparse

lobbies = []

def cleanup_old_lobbies():
    """Remove lobbies older than 30 minutes"""
    global lobbies
    cutoff = datetime.now() - timedelta(minutes=30)
    lobbies = [l for l in lobbies if datetime.fromtimestamp(l['timestamp'] / 1000) > cutoff]

class MatchmakingHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def _send_json_response(self, status_code, data):
        self.send_response(status_code)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        cleanup_old_lobbies()
        
        parsed_path = urlparse(self.path)
        if parsed_path.path != '/api/lobbies':
            self._send_json_response(404, {'error': 'Not found'})
            return
        
        lobby_list = [{
            'peerId': l['peerId'],
            'hostName': l['hostName'],
            'playerCount': l['playerCount'],
            'maxPlayers': l['maxPlayers'],
            'timestamp': l['timestamp']
        } for l in lobbies]
        
        self._send_json_response(200, {'lobbies': lobby_list})
    
    def do_POST(self):
        cleanup_old_lobbies()
        
        parsed_path = urlparse(self.path)
        if parsed_path.path != '/api/lobbies':
            self._send_json_response(404, {'error': 'Not found'})
            return
        
        try:
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            peer_id = data.get('peerId')
            host_name = data.get('hostName')
            
            if not peer_id or not host_name:
                self._send_json_response(400, {'error': 'Missing required fields'})
                return
            
            # Find existing lobby
            existing_index = None
            for i, lobby in enumerate(lobbies):
                if lobby['peerId'] == peer_id:
                    existing_index = i
                    break
            
            lobby_data = {
                'peerId': peer_id,
                'hostName': host_name,
                'playerCount': data.get('playerCount', 1),
                'maxPlayers': data.get('maxPlayers', 10),
                'timestamp': int(datetime.now().timestamp() * 1000)
            }
            
            if existing_index is not None:
                lobbies[existing_index] = lobby_data
            else:
                lobbies.append(lobby_data)
            
            self._send_json_response(200, {'success': True})
        
        except Exception as e:
            self._send_json_response(400, {'error': 'Invalid JSON'})
    
    def do_DELETE(self):
        cleanup_old_lobbies()
        
        parsed_path = urlparse(self.path)
        if parsed_path.path != '/api/lobbies':
            self._send_json_response(404, {'error': 'Not found'})
            return
        
        try:
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            peer_id = data.get('peerId')
            
            if not peer_id:
                self._send_json_response(400, {'error': 'Missing peerId'})
                return
            
            global lobbies
            lobbies = [l for l in lobbies if l['peerId'] != peer_id]
            
            self._send_json_response(200, {'success': True})
        
        except Exception as e:
            self._send_json_response(400, {'error': 'Invalid JSON'})
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

def run_server(port=3000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, MatchmakingHandler)
    print(f'🎮 Matchmaking server running on http://localhost:{port}')
    print(f'📡 API endpoint: http://localhost:{port}/api/lobbies')
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
