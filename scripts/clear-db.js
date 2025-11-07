require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script simple para limpiar todas las colecciones de la base de datos
 * Sin confirmación - ejecuta directamente
 */

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGODB_URI no está definido en las variables de entorno');
  process.exit(1);
}

async function clearDatabase() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log(`✓ Conectado a: ${mongoose.connection.name}`);

    // Obtener todas las colecciones usando listCollections (incluye vacías)
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (collectionNames.length === 0) {
      console.log('ℹ️  No hay colecciones en la base de datos');
      await mongoose.connection.close();
      return;
    }

    console.log(`\n📋 Encontradas ${collectionNames.length} colecciones:`);
    collectionNames.forEach((name) => {
      console.log(`   - ${name}`);
    });

    console.log('\n🗑️  Eliminando todos los datos y colecciones...');

    let totalDeleted = 0;
    for (const collectionName of collectionNames) {
      try {
        const collection = db.collection(collectionName);
        const count = await collection.countDocuments();
        
        // Eliminar todos los documentos
        if (count > 0) {
          await collection.deleteMany({});
          console.log(`   ✓ ${collectionName}: ${count} documentos eliminados`);
          totalDeleted += count;
        }
        
        // Eliminar la colección completa (incluye índices)
        await collection.drop();
        console.log(`   ✓ ${collectionName}: colección eliminada`);
      } catch (error) {
        // Si la colección no existe o ya fue eliminada, continuar
        if (error.code === 26 || error.message.includes('ns not found')) {
          console.log(`   ○ ${collectionName}: ya no existe`);
        } else {
          console.error(`   ✗ Error al limpiar ${collectionName}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Limpieza completada. Total de documentos eliminados: ${totalDeleted}`);
    console.log(`✅ Total de colecciones eliminadas: ${collectionNames.length}`);
    console.log('🔌 Cerrando conexión...');
    await mongoose.connection.close();
    console.log('✓ Conexión cerrada\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar el script
clearDatabase()
  .then(() => {
    console.log('✨ Proceso finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

