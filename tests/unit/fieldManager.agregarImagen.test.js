/**
 * Unit Test: fieldManager.agregarImagen
 * Verifica la gestión del array de imágenes en datosTemp
 */

const { agregarImagen } = require('../../bot/services/fieldManager');

describe('fieldManager.agregarImagen', () => {
  test('inicializa imagenes[] cuando no existe', () => {
    const datos = {};
    agregarImagen(datos, 'https://blob/img1.jpg', 'ocr');

    expect(datos.imagenes).toHaveLength(1);
    expect(datos.imagenes[0]).toMatchObject({
      url: 'https://blob/img1.jpg',
      tipo: 'ocr',
    });
    expect(datos.imagenes[0].fecha).toBeDefined();
  });

  test('establece imagenUrl para backward compatibility', () => {
    const datos = {};
    agregarImagen(datos, 'https://blob/img1.jpg', 'ocr');

    expect(datos.imagenUrl).toBe('https://blob/img1.jpg');
  });

  test('migra imagenUrl legacy al array', () => {
    const datos = { imagenUrl: 'https://blob/legacy.jpg' };
    agregarImagen(datos, 'https://blob/new.jpg', 'ai_vision');

    expect(datos.imagenes).toHaveLength(2);
    expect(datos.imagenes[0]).toMatchObject({
      url: 'https://blob/legacy.jpg',
      tipo: 'legacy',
    });
    expect(datos.imagenes[1]).toMatchObject({
      url: 'https://blob/new.jpg',
      tipo: 'ai_vision',
    });
    // imagenUrl apunta a la primera (legacy)
    expect(datos.imagenUrl).toBe('https://blob/legacy.jpg');
  });

  test('evita duplicados por URL', () => {
    const datos = {};
    agregarImagen(datos, 'https://blob/img1.jpg', 'ocr');
    agregarImagen(datos, 'https://blob/img1.jpg', 'ai_vision');

    expect(datos.imagenes).toHaveLength(1);
  });

  test('agrega múltiples imágenes distintas', () => {
    const datos = {};
    agregarImagen(datos, 'https://blob/img1.jpg', 'ocr');
    agregarImagen(datos, 'https://blob/img2.jpg', 'ai_vision');
    agregarImagen(datos, 'https://blob/img3.jpg', 'evidencia');

    expect(datos.imagenes).toHaveLength(3);
    expect(datos.imagenUrl).toBe('https://blob/img1.jpg'); // primera
  });

  test('retorna datosTemp sin cambios si url es null', () => {
    const datos = { foo: 'bar' };
    const result = agregarImagen(datos, null, 'ocr');

    expect(result).toBe(datos);
    expect(datos.imagenes).toBeUndefined();
  });

  test('retorna datosTemp sin cambios si url es vacía', () => {
    const datos = {};
    agregarImagen(datos, '', 'ocr');

    expect(datos.imagenes).toBeUndefined();
  });

  test('preserva array existente al agregar nueva imagen', () => {
    const datos = {
      imagenes: [{ url: 'https://blob/prev.jpg', tipo: 'ocr', fecha: '2026-01-01T00:00:00.000Z' }],
      imagenUrl: 'https://blob/prev.jpg',
    };
    agregarImagen(datos, 'https://blob/new.jpg', 'evidencia');

    expect(datos.imagenes).toHaveLength(2);
    expect(datos.imagenes[1].url).toBe('https://blob/new.jpg');
    // No migra legacy ya que imagenes[] ya existe
    expect(datos.imagenUrl).toBe('https://blob/prev.jpg');
  });
});
