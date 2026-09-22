"""
app.py
Flask server for the food spoilage monitor.

Run with:  python app.py
Listens on every network interface, port 8000, so ESPs on the same
network can reach it at http://<this-computer's-IP>:8000
"""

import time
from contextlib import closing

from flask import Flask, jsonify, request

from db import get_connection, init_db, insert_readings, register_device

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
                                            payload.get("firmware"), now=server_ts)
                result = insert_readings(conn, device_id, payload.get("samples"),
                                         server_ts=server_ts)
    except ValueError as err:
        return jsonify(error=str(err)), 400

    return jsonify(result), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8000)
