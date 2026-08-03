# Backend Service

## Overview

The backend service is a Node.js and Express REST API responsible for all business logic in Pipeline360.

It manages hotel data, reservation creation, reservation lookup, reservation cancellation, and communication with MongoDB.

---

## Technology Stack

- Node.js
- Express
- MongoDB
- Mongoose

---

## Project Structure

```text
src/
├── config/
├── controllers/
├── models/
├── routes/
└── server.js
```

---

## REST API

### Health

```text
GET /health
```

Response

```json
{
  "status": "healthy"
}
```

---

### Readiness

```text
GET /ready
```

Response

```json
{
  "status": "ready",
  "database": "connected"
}
```

---

### Hotels

```text
GET /api/reservations/hotels
```

Returns all hotels stored in MongoDB.

---

### Create Reservation

```text
POST /api/reservations
```

Example request

```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "checkIn": "2030-06-10",
  "checkOut": "2030-06-12",
  "hotelId": "hotel_001"
}
```

---

### Lookup Reservation

```text
GET /api/reservations/lookup/{query}
```

Supports:

- Reservation ID
- Full name
- Email

---

### Cancel Reservation

```text
DELETE /api/reservations/{reservationId}
```

---

## Validation Rules

The backend validates:

- Required fields
- Email
- Existing hotel
- Valid dates
- Check-out after check-in
- Reservation availability
- Unique reservation ID

---

## MongoDB Collections

### hotels

Stores hotel information.

### reservations

Stores reservation information.

---

## Environment Variables

```text
PORT
MONGO_URL
```
`MONGO_URL` is provided by the `app-config` Kubernetes ConfigMap.

The backend does not currently use a separate MongoDB password environment
variable because MongoDB internal authentication is not enabled in the local
Kind environment.

---

## Kubernetes

Deployment:

```text
infra-repo/kubernetes/backend/deployment.yaml
```

Service:

```text
infra-repo/kubernetes/backend/service.yaml
```

Default replicas:

```text
5
```

---

## Docker

The backend image is built automatically by GitHub Actions and pushed to Docker Hub.

---

## Related Documentation

- ../README.md
- ../PIPELINE360_STARTUP_GUIDE.md
- ../infra-repo/README.md