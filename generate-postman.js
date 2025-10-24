/**
 * Generate Postman Collection from OpenAPI Spec
 * Creates a Postman Collection v2.1 for testing the API
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { swaggerSpec } = require('./src/api/middlewares/swagger');

const docsDir = path.join(__dirname, 'docs');

// Create docs directory if it doesn't exist
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

// Create Postman Collection v2.1
const collection = {
  info: {
    name: swaggerSpec.info.title,
    description: swaggerSpec.info.description,
    version: swaggerSpec.info.version,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  variable: [
    {
      key: 'baseUrl',
      value: swaggerSpec.servers[0].url,
      type: 'string'
    },
    {
      key: 'access_token',
      value: '',
      type: 'string',
      description: 'JWT token from login (automatically set by login request)'
    }
  ],
  item: []
};

// Helper to convert OpenAPI path params to Postman format
function convertPath(path) {
  return path.replace(/{([^}]+)}/g, ':$1');
}

// Helper to get example value
function getExampleValue(schema, examples) {
  if (examples && Object.keys(examples).length > 0) {
    const firstExample = Object.values(examples)[0];
    return firstExample.value || firstExample;
  }
  if (schema && schema.example) {
    return schema.example;
  }
  return null;
}

// Process each path
Object.entries(swaggerSpec.paths).forEach(([pathUrl, pathItem]) => {
  Object.entries(pathItem).forEach(([method, operation]) => {
    if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
      const request = {
        name: operation.summary || `${method.toUpperCase()} ${pathUrl}`,
        request: {
          method: method.toUpperCase(),
          header: [],
          url: {
            raw: `{{baseUrl}}${convertPath(pathUrl)}`,
            host: ['{{baseUrl}}'],
            path: pathUrl.split('/').filter(p => p)
          },
          description: operation.description || ''
        },
        response: []
      };

      // Add security (cookies)
      if (operation.security && operation.security.some(s => s.cookieAuth)) {
        request.request.header.push({
          key: 'Cookie',
          value: 'access_token={{access_token}}',
          type: 'text',
          description: 'JWT authentication cookie'
        });
      }

      // Add request body
      if (operation.requestBody && operation.requestBody.content) {
        const content = operation.requestBody.content;
        
        if (content['application/json']) {
          request.request.header.push({
            key: 'Content-Type',
            value: 'application/json',
            type: 'text'
          });
          
          const example = getExampleValue(
            content['application/json'].schema,
            content['application/json'].examples
          );
          
          if (example) {
            request.request.body = {
              mode: 'raw',
              raw: JSON.stringify(example, null, 2),
              options: {
                raw: {
                  language: 'json'
                }
              }
            };
          }
        }
        
        if (content['multipart/form-data']) {
          const schema = content['multipart/form-data'].schema;
          request.request.body = {
            mode: 'formdata',
            formdata: []
          };
          
          if (schema && schema.properties) {
            Object.entries(schema.properties).forEach(([key, prop]) => {
              if (prop.format === 'binary') {
                request.request.body.formdata.push({
                  key: key,
                  type: 'file',
                  src: [],
                  description: prop.description || ''
                });
              } else {
                request.request.body.formdata.push({
                  key: key,
                  value: prop.example || '',
                  type: 'text',
                  description: prop.description || ''
                });
              }
            });
          }
        }
      }

      // Add to appropriate folder based on tags
      const tag = operation.tags && operation.tags[0] ? operation.tags[0] : 'Other';
      let folder = collection.item.find(f => f.name === tag);
      
      if (!folder) {
        folder = {
          name: tag,
          item: []
        };
        collection.item.push(folder);
      }
      
      folder.item.push(request);
    }
  });
});

// Add Auth folder with login/logout
const authFolder = {
  name: 'Authentication',
  item: [
    {
      name: 'Login (Temporary)',
      event: [
        {
          listen: 'test',
          script: {
            exec: [
              '// Extract access_token from Set-Cookie header',
              'const cookies = pm.response.headers.get("Set-Cookie");',
              'if (cookies) {',
              '    const match = cookies.match(/access_token=([^;]+)/);',
              '    if (match) {',
              '        pm.collectionVariables.set("access_token", match[1]);',
              '        console.log("✓ Access token saved to collection variable");',
              '    }',
              '}',
              '',
              '// Verify successful login',
              'pm.test("Status code is 200", function () {',
              '    pm.response.to.have.status(200);',
              '});',
              '',
              'pm.test("Response has user object", function () {',
              '    const jsonData = pm.response.json();',
              '    pm.expect(jsonData).to.have.property("user");',
              '});'
            ],
            type: 'text/javascript'
          }
        }
      ],
      request: {
        method: 'POST',
        header: [
          {
            key: 'Content-Type',
            value: 'application/json'
          }
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify({
            corporateEmail: 'test@unisabana.edu.co',
            password: 'YourPassword123!'
          }, null, 2),
          options: {
            raw: {
              language: 'json'
            }
          }
        },
        url: {
          raw: '{{baseUrl}}/auth/login',
          host: ['{{baseUrl}}'],
          path: ['auth', 'login']
        },
        description: 'Login to get access_token cookie (automatically saved to collection variable)'
      }
    },
    {
      name: 'Logout',
      request: {
        method: 'POST',
        header: [
          {
            key: 'Cookie',
            value: 'access_token={{access_token}}',
            type: 'text'
          }
        ],
        url: {
          raw: '{{baseUrl}}/auth/logout',
          host: ['{{baseUrl}}'],
          path: ['auth', 'logout']
        },
        description: 'Logout and clear access_token cookie'
      }
    }
  ]
};

// Insert auth folder at the beginning
collection.item.unshift(authFolder);

// Save to file
const collectionPath = path.join(docsDir, 'postman_collection.json');
fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));

console.log(`✓ Postman Collection exported to: ${collectionPath}`);
console.log('\n📦 Collection Summary:');
console.log(`Name: ${collection.info.name}`);
console.log(`Version: ${collection.info.version}`);
console.log(`Folders: ${collection.item.length}`);

collection.item.forEach(folder => {
  console.log(`  📁 ${folder.name}: ${folder.item.length} request(s)`);
  folder.item.forEach(req => {
    console.log(`    ${req.request.method} ${req.name}`);
  });
});

console.log('\n📥 Import Instructions:');
console.log('1. Open Postman');
console.log('2. Click "Import" button');
console.log('3. Select: backend/docs/postman_collection.json');
console.log('4. Run "Login (Temporary)" first to set access_token');
console.log('5. All authenticated requests will use the token automatically');

console.log('\n✅ Postman collection generated successfully!');

