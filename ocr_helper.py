import sys
import base64
import os
import warnings

warnings.filterwarnings('ignore')

old_stdout = sys.stdout
sys.stdout = open(os.devnull, 'w')

import ddddocr

ocr = ddddocr.DdddOcr()

sys.stdout.close()
sys.stdout = old_stdout

while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        image_bytes = base64.b64decode(line)
        result = ocr.classification(image_bytes)
        print(result, flush=True)
    except Exception as e:
        print(f'ERROR: {e}', flush=True)