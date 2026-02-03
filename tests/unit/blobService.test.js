/**
 * Tests para BlobService
 * Valida subida de imagenes, generacion de SAS tokens y manejo de errores
 */

// Mock de Azure Storage Blob
const mockUpload = jest.fn();
const mockDeleteIfExists = jest.fn();
const mockCreateIfNotExists = jest.fn();

jest.mock('@azure/storage-blob', () => ({
    BlobServiceClient: {
        fromConnectionString: jest.fn().mockReturnValue({
            getContainerClient: jest.fn().mockReturnValue({
                createIfNotExists: mockCreateIfNotExists,
                getBlockBlobClient: jest.fn().mockReturnValue({
                    upload: mockUpload,
                    deleteIfExists: mockDeleteIfExists,
                    url: 'https://testaccount.blob.core.windows.net/imagenes-reportes/test.jpg'
                })
            })
        })
    },
    generateBlobSASQueryParameters: jest.fn().mockReturnValue({
        toString: () => 'sv=2020-08-04&st=2024-01-01&se=2025-01-01&sr=b&sp=r&sig=test'
    }),
    BlobSASPermissions: {
        parse: jest.fn().mockReturnValue({})
    },
    StorageSharedKeyCredential: jest.fn()
}));

describe('BlobService', () => {
    let blobService;
    const originalEnv = process.env;

    const validConnectionString = 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net';

    beforeAll(() => {
        process.env = {
            ...originalEnv,
            BLOB_CONNECTION_STRING: validConnectionString
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockUpload.mockResolvedValue({});
        mockDeleteIfExists.mockResolvedValue({});
        mockCreateIfNotExists.mockResolvedValue({});
        blobService = require('../../core/services/storage/blobService');
    });

    describe('uploadImage', () => {
        it('debe subir imagen y retornar URL con SAS token', async () => {
            const imageBuffer = Buffer.from('fake-image-data');
            const telefono = '5218112345678';

            const url = await blobService.uploadImage(imageBuffer, telefono, 'jpg');

            expect(url).toContain('https://');
            expect(url).toContain('.blob.core.windows.net');
            expect(url).toContain('sv='); // SAS token params
            expect(mockUpload).toHaveBeenCalledWith(
                imageBuffer,
                imageBuffer.length,
                expect.objectContaining({
                    blobHTTPHeaders: expect.objectContaining({
                        blobContentType: 'image/jpeg'
                    })
                })
            );
        });

        it('debe usar extension por defecto jpg', async () => {
            const imageBuffer = Buffer.from('fake-image-data');
            const telefono = '5218112345678';

            await blobService.uploadImage(imageBuffer, telefono);

            expect(mockUpload).toHaveBeenCalledWith(
                imageBuffer,
                imageBuffer.length,
                expect.objectContaining({
                    blobHTTPHeaders: expect.objectContaining({
                        blobContentType: 'image/jpeg'
                    })
                })
            );
        });

        it('debe soportar diferentes formatos de imagen', async () => {
            const imageBuffer = Buffer.from('fake-image-data');
            const telefono = '5218112345678';

            await blobService.uploadImage(imageBuffer, telefono, 'png');

            expect(mockUpload).toHaveBeenCalledWith(
                imageBuffer,
                imageBuffer.length,
                expect.objectContaining({
                    blobHTTPHeaders: expect.objectContaining({
                        blobContentType: 'image/png'
                    })
                })
            );
        });

        it('debe manejar error de subida', async () => {
            mockUpload.mockRejectedValue(new Error('Upload failed'));

            const imageBuffer = Buffer.from('fake-image-data');
            const telefono = '5218112345678';

            await expect(blobService.uploadImage(imageBuffer, telefono))
                .rejects.toThrow('Upload failed');
        });
    });

    describe('deleteImage', () => {
        it('debe eliminar imagen exitosamente', async () => {
            mockDeleteIfExists.mockResolvedValue({ succeeded: true });

            const url = 'https://testaccount.blob.core.windows.net/imagenes-reportes/5218112345678/123_abc.jpg?sv=2020';

            const result = await blobService.deleteImage(url);

            expect(result).toBe(true);
            expect(mockDeleteIfExists).toHaveBeenCalled();
        });

        it('debe retornar false si no puede extraer nombre del blob', async () => {
            const url = 'https://invalid-url.com/';

            const result = await blobService.deleteImage(url);

            expect(result).toBe(false);
        });

        it('debe manejar error de eliminacion', async () => {
            mockDeleteIfExists.mockRejectedValue(new Error('Delete failed'));

            const url = 'https://testaccount.blob.core.windows.net/imagenes-reportes/5218112345678/123_abc.jpg';

            const result = await blobService.deleteImage(url);

            expect(result).toBe(false);
        });
    });

    describe('getContainerClient', () => {
        it('debe inicializar cliente y crear contenedor si no existe', async () => {
            const client = await blobService.getContainerClient();

            expect(client).toBeDefined();
            expect(mockCreateIfNotExists).toHaveBeenCalled();
        });

        it('debe retornar cliente cacheado en llamadas subsecuentes', async () => {
            const client1 = await blobService.getContainerClient();
            const client2 = await blobService.getContainerClient();

            expect(client1).toBe(client2);
            // createIfNotExists solo deberia llamarse una vez
            expect(mockCreateIfNotExists).toHaveBeenCalledTimes(1);
        });
    });

    describe('sin BLOB_CONNECTION_STRING', () => {
        beforeEach(() => {
            jest.resetModules();
            delete process.env.BLOB_CONNECTION_STRING;
        });

        afterEach(() => {
            process.env.BLOB_CONNECTION_STRING = validConnectionString;
        });

        it('debe lanzar error si no hay connection string', async () => {
            const blobServiceNoConfig = require('../../core/services/storage/blobService');
            const imageBuffer = Buffer.from('fake-image-data');

            await expect(blobServiceNoConfig.uploadImage(imageBuffer, '5218112345678'))
                .rejects.toThrow('BLOB_CONNECTION_STRING no está configurado');
        });
    });
});
