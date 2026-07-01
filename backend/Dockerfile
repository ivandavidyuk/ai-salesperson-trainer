# FastAPI WebSocket-сервер голосового пайплайна.

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Устанавливаем зависимости отдельным слоем (кешируется, пока не менялся requirements)
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
