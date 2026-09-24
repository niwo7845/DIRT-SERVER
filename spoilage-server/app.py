"""
app.py
Flask server for the food spoilage monitor.

Run with:  python app.py
Listens on every network interface, port 8000, so ESPs on the same
network can reach it at http://<this-computer's-IP>:8000
"""

import os
import time
from contextlib import closing

from flask import Flask, jsonify, request

from db import get_connection, init_db, insert_readings, register_device

HOST = os.environ.get("DIRT_HOST", "0.0.0.0")   # 0.0.0.0 = accept from any device on the LAN
PORT = int(os.environ.get("DIRT_PORT", "8000"))  # must match SERVER_PORT in the ESP sketch

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024  # reject bodies over 256 kB


@app.post("/api/v1/readings")
def post_readings():
    """
    Receive one payload from an ESP, register the device, store its readings.

    200: payload processed (check "rejected" for any individual bad readings).
         The ESP may delete these samples from its buffer.
    400: payload unusable, nothing saved. Resending the same thing won't help.
    500: server-side problem, nothing saved. The ESP should keep the samples
         and retry later.
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="body must be a JSON object sent with "
                             "Content-Type: application/json"), 400

    server_ts = int(time.time())

    try:
        with closing(get_connection()) as conn:
            with conn:  # one transaction: commits on success, rolls back on any error
                device_id = register_device(conn, payload.get("device_id"),
                                            now=server_ts)
                result = insert_readings(conn, device_id, payload.get("samples"),
                                         server_ts=server_ts)
    except ValueError as err:
        return jsonify(error=str(err)), 400

    return jsonify(result), 200


if __name__ == "__main__":
    init_db()
    print(f"DIRT server listening on {HOST}:{PORT}")
    try:
        from waitress import serve  # production server; survives long unattended runs
        serve(app, host=HOST, port=PORT, threads=8)
    except ImportError:
        print("waitress not installed, falling back to the Flask dev server")
        app.run(host=HOST, port=PORT)
