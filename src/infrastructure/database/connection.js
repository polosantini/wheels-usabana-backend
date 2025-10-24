const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const options = {
    };

    // Conectar a MongoDB
    const conn = await mongoose.connect(process.env.MONGODB_URI, options);
    
    console.log(`✓ MongoDB Connected: ${conn.connection.host}`);
    console.log(`✓ Database: ${conn.connection.name}`);

    try {
      await conn.connection.db.collection('users').createIndexes([
        { key: { corporateEmail: 1 }, unique: true, name: 'corporateEmail_unique' },
        { key: { universityId: 1 }, unique: true, name: 'universityId_unique' },
        { key: { phone: 1 }, unique: true, name: 'phone_unique' }
      ]);
      
      await conn.connection.db.collection('vehicles').createIndexes([
        { key: { plate: 1 }, unique: true, name: 'plate_unique' },
        { key: { driverId: 1 }, unique: false, name: 'driverId_index' }
      ]);
      
      console.log('✓ Indexes verified and created');
    } catch (indexError) {
      // Si los índices ya existen, está bien
      if (indexError.code === 85 || indexError.codeName === 'IndexOptionsConflict') {
        console.log('✓ Indexes already exist');
      } else {
        console.warn('⚠ Index creation warning:', indexError.message);
      }
    }
    
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1); // Salir si no se puede conectar a la DB
  }
};

// Event handlers para monitoreo de conexión
mongoose.connection.on('connected', () => {
  console.log('✓ Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠ Mongoose disconnected from DB');
});

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('✓ Mongoose connection closed through app termination');
    process.exit(0);
  } catch (err) {
    console.error('✗ Error closing mongoose connection:', err);
    process.exit(1);
  }
});

module.exports = connectDB;

