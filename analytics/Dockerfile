FROM python:3.11-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim

RUN groupadd -g 1001 analytics && \
    useradd -u 1001 -g analytics -s /bin/sh -M analytics

WORKDIR /app

COPY --from=builder /install /usr/local

COPY . .

RUN chown -R analytics:analytics /app

USER analytics

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "2"]
