"""
Download and pre-process the CWRU bearing-fault dataset.

Output files are written to DATA_DIR (default: ./data/).
Raw .mat downloads are cached in DATA_DIR/cwru_data/.

Usage
-----
    python get_data.py                     # writes to ./data/
    DATA_DIR=/mnt/data  python get_data.py # custom output directory
    docker compose run --rm api python get_data.py
"""
import os
import pathlib

import requests
import scipy.io
import numpy as np
import pandas as pd

# ── Directories ───────────────────────────────────────────────────────────────
_BASE      = pathlib.Path(__file__).parent
OUTPUT_DIR = pathlib.Path(os.environ.get("DATA_DIR", str(_BASE / "data")))
CWRU_DIR   = OUTPUT_DIR / "cwru_data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CWRU_DIR.mkdir(parents=True, exist_ok=True)

# ── File list ─────────────────────────────────────────────────────────────────
BASE_URL = "https://engineering.case.edu/sites/default/files/"

# (filename, label_int, fault_str, load_hp)
# Labels: 0=Normal, 1=IR, 2=OR, 3=Ball
FILES = [
    # Normal (from 12k/48k normal baseline)
    ("97.mat",  0, "Normal", 0), ("98.mat",  0, "Normal", 1),
    ("99.mat",  0, "Normal", 2), ("100.mat", 0, "Normal", 3),
    # Inner Race - 0.007"
    ("109.mat", 1, "IR007", 0), ("110.mat", 1, "IR007", 1),
    ("111.mat", 1, "IR007", 2), ("112.mat", 1, "IR007", 3),
    # Inner Race - 0.014"
    ("174.mat", 1, "IR014", 0), ("175.mat", 1, "IR014", 1),
    ("176.mat", 1, "IR014", 2), ("177.mat", 1, "IR014", 3),
    # Inner Race - 0.021"
    ("213.mat", 1, "IR021", 0), ("214.mat", 1, "IR021", 1),
    ("215.mat", 1, "IR021", 2), ("216.mat", 1, "IR021", 3),
    # Ball - 0.007"
    ("122.mat", 3, "B007", 0), ("123.mat", 3, "B007", 1),
    ("124.mat", 3, "B007", 2), ("125.mat", 3, "B007", 3),
    # Ball - 0.014"
    ("189.mat", 3, "B014", 0), ("190.mat", 3, "B014", 1),
    ("191.mat", 3, "B014", 2), ("192.mat", 3, "B014", 3),
    # Ball - 0.021"
    ("226.mat", 3, "B021", 0), ("227.mat", 3, "B021", 1),
    ("228.mat", 3, "B021", 2), ("229.mat", 3, "B021", 3),
    # Outer Race @6:00 - 0.007"
    ("135.mat", 2, "OR007@6", 0), ("136.mat", 2, "OR007@6", 1),
    ("137.mat", 2, "OR007@6", 2), ("138.mat", 2, "OR007@6", 3),
    # Outer Race @6:00 - 0.014"
    ("201.mat", 2, "OR014@6", 0), ("202.mat", 2, "OR014@6", 1),
    ("203.mat", 2, "OR014@6", 2), ("204.mat", 2, "OR014@6", 3),
    # Outer Race @6:00 - 0.021"
    ("238.mat", 2, "OR021@6", 0), ("239.mat", 2, "OR021@6", 1),
    ("240.mat", 2, "OR021@6", 2), ("241.mat", 2, "OR021@6", 3),
]


# ── Download helpers ──────────────────────────────────────────────────────────

def _download(url: str, dest: pathlib.Path, retries: int = 4) -> bool:
    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, timeout=60, stream=True) as r:
                if r.status_code != 200:
                    print(f"  WARNING: HTTP {r.status_code} — {url}")
                    return False
                tmp = str(dest) + ".part"
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=65536):
                        f.write(chunk)
                os.replace(tmp, dest)
                return True
        except Exception as exc:
            print(f"  Attempt {attempt} failed: {exc}")
    print(f"  GIVING UP: {dest}")
    return False


def download_files() -> None:
    for fname, _label, fault, load in FILES:
        dest = CWRU_DIR / fname
        if dest.exists():
            try:
                scipy.io.loadmat(str(dest))
                print(f"  OK (cached): {fname}")
                continue
            except Exception:
                print(f"  Corrupt cache, re-downloading: {fname}")
                dest.unlink()
        print(f"  Downloading {fname} ({fault}, load={load}) ...")
        _download(BASE_URL + fname, dest)


# ── Signal extraction + segmentation ─────────────────────────────────────────

def _extract_de_signal(mat: dict) -> np.ndarray | None:
    """Extract Drive End accelerometer signal from a loaded .mat dict."""
    for key in mat:
        if key.startswith("_"):
            continue
        if "DE" in key and "time" in key.lower():
            return mat[key].squeeze()
    return None


def load_and_segment(window_size: int = 1024, step: int = 512):
    X, y, meta = [], [], []

    for fname, label, fault, load in FILES:
        path = CWRU_DIR / fname
        if not path.exists():
            print(f"  Missing: {fname}, skipping.")
            continue

        mat    = scipy.io.loadmat(str(path))
        signal = _extract_de_signal(mat)

        if signal is None:
            keys = [k for k in mat if not k.startswith("_")]
            print(f"  No DE signal in {fname}. Keys: {keys}")
            continue

        n = (len(signal) - window_size) // step + 1
        for i in range(n):
            s = i * step
            w = signal[s: s + window_size]
            if len(w) == window_size:
                X.append(w)
                y.append(label)
                meta.append({"file": fname, "fault": fault, "load": load, "window": i})

    return (
        np.array(X, dtype=np.float32),
        np.array(y, dtype=np.int64),
        pd.DataFrame(meta),
    )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Output directory : {OUTPUT_DIR}")
    print(f"CWRU cache       : {CWRU_DIR}")

    print("\n=== Downloading CWRU 48k Drive End files ===")
    download_files()

    print("\n=== Loading and segmenting signals ===")
    X, y, meta = load_and_segment(window_size=1024, step=512)

    print(f"\nX shape : {X.shape}")
    print(f"y shape : {y.shape}")

    label_names = {0: "Normal", 1: "IR", 2: "OR", 3: "Ball"}
    print("\nClass distribution:")
    for lbl, cnt in pd.Series(y).value_counts().sort_index().items():
        print(f"  {lbl} ({label_names[lbl]}): {cnt} windows")

    np.save(OUTPUT_DIR / "X.npy", X)
    np.save(OUTPUT_DIR / "y.npy", y)
    meta.to_csv(OUTPUT_DIR / "meta.csv", index=False)
    print(f"\nSaved X.npy, y.npy, meta.csv → {OUTPUT_DIR}")
