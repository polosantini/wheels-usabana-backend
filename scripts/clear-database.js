require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Script para limpiar todas las colecciones de la base de datos
 * ⚠️ ADVERTENCIA: Este script elimina TODOS los datos de la base de datos
 */

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGODB_URI no está definido en las variables de entorno');
  process.exit(1);
}

// Extraer el nombre de la base de datos de la URI para mostrar en la confirmación
const dbNameMatch = MONGO_URI.match(/\/([^/?]+)(\?|$)/);
const dbName = dbNameMatch ? dbNameMatch[1] : 'unknown';

async function clearDatabase() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log(`✓ Conectado a: ${mongoose.connection.name}`);

    // Obtener todas las colecciones
    const collections = mongoose.connection.collections;
    const collectionNames = Object.keys(collections);

    if (collectionNames.length === 0) {
      console.log('ℹ️  No hay colecciones en la base de datos');
      await mongoose.connection.close();
      return;
    }

    console.log('\n📋 Colecciones encontradas:');
    collectionNames.forEach((name, index) => {
      console.log(`   ${index + 1}. ${name}`);
    });

    console.log(`\n⚠️  ADVERTENCIA: Se eliminarán TODOS los datos de la base de datos "${dbName}"`);
    console.log(`   Total de colecciones: ${collectionNames.length}`);
    
    // En modo no interactivo (CI/CD), usar variable de entorno
    if (process.env.FORCE_CLEAR_DB === 'true') {
      console.log('\n🔧 Modo FORCE activado (FORCE_CLEAR_DB=true), procediendo sin confirmación...');
    } else {
      // En modo interactivo, requerir confirmación manual
      console.log('\n❓ Para confirmar, escribe "ELIMINAR" (en mayúsculas):');
      
      // Leer desde stdin
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise((resolve) => {
        rl.question('> ', resolve);
      });

      rl.close();

      if (answer !== 'ELIMINAR') {
        console.log('❌ Confirmación incorrecta. Operación cancelada.');
        await mongoose.connection.close();
        return;
      }
    }

    console.log('\n🗑️  Eliminando datos...');

    let totalDeleted = 0;
    for (const collectionName of collectionNames) {
      try {
        const collection = collections[collectionName];
        const count = await collection.countDocuments();
        if (count > 0) {
          await collection.deleteMany({});
          console.log(`   ✓ ${collectionName}: ${count} documentos eliminados`);
          totalDeleted += count;
        } else {
          console.log(`   ○ ${collectionName}: ya estaba vacía`);
        }
      } catch (error) {
        console.error(`   ✗ Error al limpiar ${collectionName}:`, error.message);
      }
    }

    console.log(`\n✅ Limpieza completada. Total de documentos eliminados: ${totalDeleted}`);
    console.log('🔌 Cerrando conexión...');
    await mongoose.connection.close();
    console.log('✓ Conexión cerrada');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar el script
clearDatabase()
  .then(() => {
    console.log('\n✨ Proceso finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

