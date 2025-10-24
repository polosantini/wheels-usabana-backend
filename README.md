# Wheels UniSabana - Backend

Backend API para la plataforma de carpooling universitario Wheels UniSabana.

## 🚀 Tecnologías

- **Node.js** - Runtime de JavaScript
- **Express** - Framework web
- **MongoDB** - Base de datos NoSQL
- **Mongoose** - ODM para MongoDB
- **JWT** - Autenticación basada en tokens
- **bcrypt** - Hash de contraseñas

## 📋 Requisitos Previos

- Node.js (v16 o superior)
- MongoDB (v5 o superior)
- npm o yarn

## ⚙️ Instalación

1. Clonar el repositorio:
```bash
git clone <tu-repo-url>
cd backend
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
Crear un archivo `.env` en la raíz con:
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wheels-unisabana
JWT_SECRET=tu_secret_key_aqui
NODE_ENV=development
```

4. Iniciar el servidor:
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── api/
│   │   ├── controllers/    # Controladores de rutas
│   │   ├── middlewares/    # Middlewares
│   │   └── routes/         # Definición de rutas
│   ├── domain/
│   │   ├── entities/       # Entidades de dominio
│   │   ├── services/       # Lógica de negocio
│   │   ├── dtos/          # Data Transfer Objects
│   │   └── errors/        # Manejo de errores
│   └── infrastructure/
│       ├── database/       # Configuración de BD
│       └── repositories/   # Acceso a datos
├── .env.example
├── .gitignore
├── package.json
└── server.js
```

## 🔌 API Endpoints

### Autenticación
- `POST /auth/register` - Registro de usuario
- `POST /auth/login` - Inicio de sesión

### Usuarios
- `GET /users/profile` - Obtener perfil
- `PUT /users/profile` - Actualizar perfil
- `PUT /users/password` - Cambiar contraseña
- `PUT /users/role` - Cambiar rol (pasajero ↔ conductor)

### Vehículos (Conductores)
- `POST /drivers/vehicles` - Registrar vehículo
- `GET /drivers/vehicles/my-vehicle` - Obtener mi vehículo
- `PUT /drivers/vehicles/:id` - Actualizar vehículo

### Viajes (Conductores)
- `POST /drivers/trips` - Crear oferta de viaje
- `GET /drivers/trips` - Listar mis viajes
- `GET /drivers/trips/:id` - Obtener detalles de viaje
- `PUT /drivers/trips/:id` - Actualizar viaje
- `DELETE /drivers/trips/:id` - Cancelar viaje

### Reservas (Pasajeros)
- `GET /passengers/trips/search` - Buscar viajes disponibles
- `POST /passengers/bookings` - Solicitar reserva
- `GET /passengers/bookings` - Listar mis reservas
- `DELETE /passengers/bookings/:id` - Cancelar reserva

### Gestión de Reservas (Conductores)
- `GET /drivers/trips/:id/bookings` - Ver solicitudes de reserva
- `POST /drivers/trips/:tripId/bookings/:bookingId/accept` - Aceptar reserva
- `POST /drivers/trips/:tripId/bookings/:bookingId/decline` - Rechazar reserva

## 🛡️ Seguridad

- Autenticación mediante JWT
- Contraseñas hasheadas con bcrypt
- Validación de datos en DTOs
- Protección CSRF
- Rate limiting (recomendado para producción)

## 📝 Licencia

Este proyecto es parte de un proyecto académico de la Universidad de La Sabana.
