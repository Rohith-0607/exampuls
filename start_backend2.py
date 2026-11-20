import os
import sys
import traceback

os.environ["INSTANCE_ID"] = "backend-2"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

print("Starting backend 2...", flush=True)

try:
    import uvicorn
    print("uvicorn imported OK", flush=True)
    uvicorn.run("app.main:app", host="127.0.0.1", port=8002, log_level="info")
except Exception as e:
    print(f"ERROR: {e}", flush=True)
    traceback.print_exc()
