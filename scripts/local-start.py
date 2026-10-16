from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser

if __name__ == "__main__":
    server = ThreadingHTTPServer(
        ("127.0.0.1", 8765),
        partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).parent)),
    )
    print("Flowboard: http://127.0.0.1:8765 (Ctrl+C to stop)")
    webbrowser.open("http://127.0.0.1:8765")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
