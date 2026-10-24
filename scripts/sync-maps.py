"""Sync shared map renderer into the standalone Sites checkout source."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
for name in ('maps.js','maps.css'):
    shutil.copy2(root/'agent/onetop/dist'/name,root/'site/src'/name)
