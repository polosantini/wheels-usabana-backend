require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const UserModel = require('../src/infrastructure/database/models/UserModel');

/**
 * Script para crear un usuario administrador
 * 
 * Este script crea un usuario admin directamente en la base de datos,
 * ya que el modelo UserModel solo permite 'passenger' y 'driver' en el enum.
 * 
 * Uso:
 *   node scripts/create-admin-user.js
 *   node scripts/create-admin-user.js --email admin@unisabana.edu.co --password Admin123
 */

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGODB_URI no está definido en las variables de entorno');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const emailArg = args.find(arg => arg.startsWith('--email='));
const passwordArg = args.find(arg => arg.startsWith('--password='));

const ADMIN_EMAIL = emailArg ? emailArg.split('=')[1] : 'admin@unisabana.edu.co';
const ADMIN_PASSWORD = passwordArg ? passwordArg.split('=')[1] : 'Admin123456';
const ADMIN_FIRST_NAME = 'Admin';
const ADMIN_LAST_NAME = 'User';
const ADMIN_UNIVERSITY_ID = '000000000';
const ADMIN_PHONE = '+573000000000';

async function createAdminUser() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log(`✓ Conectado a: ${mongoose.connection.name}\n`);

    // Check if admin user already exists
    const existingAdmin = await UserModel.findOne({ corporateEmail: ADMIN_EMAIL.toLowerCase() });
    if (existingAdmin) {
      console.log(`⚠️  Usuario con email ${ADMIN_EMAIL} ya existe.`);
      console.log('   Actualizando a rol admin...');
      
      // Update existing user to admin role (bypassing enum validation)
      await UserModel.updateOne(
        { _id: existingAdmin._id },
        { 
          $set: { 
            role: 'admin',
            firstName: ADMIN_FIRST_NAME,
            lastName: ADMIN_LAST_NAME
          }
        }
      );
      
      // Update password if provided
      if (passwordArg) {
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await UserModel.updateOne(
          { _id: existingAdmin._id },
          { $set: { password: hashedPassword } }
        );
        console.log('   ✓ Contraseña actualizada');
      }
      
      const updatedAdmin = await UserModel.findById(existingAdmin._id);
      console.log('\n✅ Usuario admin actualizado exitosamente!');
      console.log(`   ID: ${updatedAdmin._id}`);
      console.log(`   Email: ${updatedAdmin.corporateEmail}`);
      console.log(`   Rol: ${updatedAdmin.role}`);
      console.log(`   Nombre: ${updatedAdmin.firstName} ${updatedAdmin.lastName}`);
      
      await mongoose.connection.close();
      return;
    }

    // Hash password
    console.log('🔐 Generando hash de contraseña...');
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Create admin user (bypassing enum validation by setting role directly)
    console.log('👤 Creando usuario admin...');
    const adminUser = new UserModel({
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      corporateEmail: ADMIN_EMAIL.toLowerCase(),
      universityId: ADMIN_UNIVERSITY_ID,
      phone: ADMIN_PHONE,
      password: hashedPassword,
      role: 'admin' // Setting directly, bypassing enum validation
    });

    // Save with validation disabled for role field
    await adminUser.save({ validateBeforeSave: false });

    console.log('\n✅ Usuario admin creado exitosamente!');
    console.log('\n📋 Credenciales:');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   ID: ${adminUser._id}`);
    console.log(`   Rol: ${adminUser.role}`);
    console.log('\n⚠️  IMPORTANTE: Guarda estas credenciales de forma segura!');
    console.log('\n🎉 Ahora puedes iniciar sesión en el frontend con estas credenciales');

    await mongoose.connection.close();
    console.log('\n✓ Conexión cerrada');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 11000) {
      console.error('   El email o universityId ya está en uso');
    }
    console.error('\nStack:', error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run script
createAdminUser()
  .then(() => {
    console.log('\n✨ Proceso finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

