"""The desktop loads scripts, styles and fonts in a burst at startup."""
import concurrent.futures
import socket
import threading
import unittest

from onetop.server import BASE, DashboardHTTPServer, Handler


class DashboardAssetStartupTests(unittest.TestCase):
    def test_dependencies_survive_simultaneous_startup_connections(self):
        paths = ['maps.js', 'weekly.js', 'i18n.js', 'effects.js',
                 'dashboard.js', 'ranges.js', 'app.js', 'style.css', 'dashboard.css'] * 4
        server = DashboardHTTPServer(('127.0.0.1', 0), Handler)
        sockets = []
        worker = None
        try:
            # Let browser connections arrive before the accept loop catches up.
            # A small listen backlog drops these dependencies on Windows.
            for _ in paths:
                sockets.append(socket.create_connection(server.server_address, timeout=1))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()

            def request(pair):
                connection, path = pair
                connection.settimeout(5)
                connection.sendall(('GET /' + path + ' HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n').encode())
                result = b''
                while chunk := connection.recv(65536):
                    result += chunk
                headers, body = result.split(b'\r\n\r\n', 1)
                self.assertIn(b' 200 ', headers.split(b'\r\n', 1)[0])
                self.assertEqual(body, (BASE / 'dist' / path).read_bytes())

            with concurrent.futures.ThreadPoolExecutor(max_workers=len(paths)) as pool:
                list(pool.map(request, zip(sockets, paths)))
        finally:
            for connection in sockets:
                connection.close()
            if worker:
                server.shutdown()
                worker.join(5)
            server.server_close()
