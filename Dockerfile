FROM python:3.12-slim

WORKDIR /usr/src/app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py store.py security.py panels.py ./
COPY src ./src

ENV DATA_FILE=/app/data/state.json

CMD ["python", "main.py"]
