// services/subcategoryService.js
import prisma from '../config/database.js';
import s3UploadService from './s3UploadService.js';
import logger from '../utils/logger.js';

class SubcategoryService {
  // Get all subcategories with pagination and filtering
async getAllSubcategories({ page, limit, categoryId, isActive }) {
  const skip = (page - 1) * limit;
  
  
  const where = {};
  
  if (categoryId) {
    where.categoryId = categoryId;
  }
  
  if (isActive !== undefined) {
    where.isActive = isActive;
  }
  
  
  const [subcategories, total] = await Promise.all([
    prisma.subcategory.findMany({
      where,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            id: true, 
            name: true,
            image: true
          }
        },
        products: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            productCode: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    }),
    prisma.subcategory.count({ where })
  ]);
  

  
  return {
    subcategories,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
}
  
  // Get subcategory by ID
  async getSubcategoryById(subcategoryId) {
    const subcategory = await prisma.subcategory.findUnique({
      where: { id: subcategoryId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            image: true
          }
        },
        products: {
          where: { status: 'ACTIVE' },
          include: {
            images: {
              take: 1,
              where: { isPrimary: true }
            },
            variants: {
              take: 1
            }
          }
        }
      }
    });
    
    if (!subcategory) {
      throw new Error('Subcategory not found');
    }
    
    return subcategory;
  }
  
  // Create subcategory
  async createSubcategory(subcategoryData, file = null) {
    const { name, description = null, categoryId, isActive = true } = subcategoryData;
    
    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId }
    });
    
    if (!category) {
      throw new Error('Category not found');
    }
    
    // Check if subcategory name already exists in the same category
    const existingSubcategory = await prisma.subcategory.findFirst({
      where: { 
        name,
        categoryId 
      }
    });
    
    if (existingSubcategory) {
      throw new Error('Subcategory name already exists in this category');
    }
    
    let imageUrl = null;
    let imagePublicId = null;
    
    // Upload subcategory image if provided
    if (file) {
      try {
        const uploadResult = await s3UploadService.uploadImage(
          file.buffer, 
          'subcategories'
        );
        imageUrl = uploadResult.url;
        imagePublicId = uploadResult.key;
      } catch (uploadError) {
        logger.error('Failed to upload subcategory image:', uploadError);
        throw new Error('Failed to upload subcategory image');
      }
    }
    
    const subcategory = await prisma.subcategory.create({
      data: {
        name,
        description, // Now optional, can be null
        image: imageUrl, // Can be null if no image
        imagePublicId, // Can be null if no image
        isActive,
        categoryId
      },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    logger.info(`Subcategory created: ${subcategory.id}`);
    return subcategory;
  }
  
  // Update subcategory
  async updateSubcategory(subcategoryId, updateData, file = null) {
    const subcategory = await prisma.subcategory.findUnique({
      where: { id: subcategoryId }
    });
    
    if (!subcategory) {
      throw new Error('Subcategory not found');
    }
    
    const { name, description, categoryId, isActive } = updateData;
    
    // Convert isActive from string to boolean if needed
    const isActiveBoolean = isActive === 'true' || isActive === true;
    
    // Check if category is being updated and if it exists
    if (categoryId && categoryId !== subcategory.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId }
      });
      
      if (!category) {
        throw new Error('Category not found');
      }
    }
    
    // Check if subcategory name is being updated and if it's already taken
    if (name && name !== subcategory.name) {
      const existingSubcategory = await prisma.subcategory.findFirst({
        where: {
          name,
          categoryId: categoryId || subcategory.categoryId,
          id: { not: subcategoryId }
        }
      });
      
      if (existingSubcategory) {
        throw new Error('Subcategory name already exists in this category');
      }
    }
    
    let imageUrl = subcategory.image;
    let imagePublicId = subcategory.imagePublicId;
    
    // Upload new subcategory image if provided
    if (file) {
      // Delete old image if exists
      if (subcategory.imagePublicId) {
        try {
          await s3UploadService.deleteImage(subcategory.imagePublicId);
        } catch (error) {
          logger.error('Failed to delete old subcategory image:', error);
          // Continue with new upload
        }
      }
      
      try {
        const uploadResult = await s3UploadService.uploadImage(
          file.buffer, 
          'subcategories'
        );
        imageUrl = uploadResult.url;
        imagePublicId = uploadResult.key;
      } catch (uploadError) {
        logger.error('Failed to upload subcategory image:', uploadError);
        throw new Error('Failed to upload subcategory image');
      }
    }
    
    const updatedSubcategory = await prisma.subcategory.update({
      where: { id: subcategoryId },
      data: {
        name,
        description,
        image: imageUrl,
        imagePublicId,
        categoryId,
        isActive: isActiveBoolean, // Use the converted boolean value
        updatedAt: new Date()
      },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    logger.info(`Subcategory updated: ${subcategoryId}`);
    return updatedSubcategory;
  }
  
  // Delete subcategory
  async deleteSubcategory(subcategoryId) {
    const subcategory = await prisma.subcategory.findUnique({
      where: { id: subcategoryId },
      include: {
        products: true
      }
    });
    
    if (!subcategory) {
      throw new Error('Subcategory not found');
    }
    
    // Check if subcategory has products
    if (subcategory.products.length > 0) {
      throw new Error('Cannot delete subcategory with existing products');
    }
    
    // Delete subcategory image from S3 if exists
    if (subcategory.imagePublicId) {
      try {
        await s3UploadService.deleteImage(subcategory.imagePublicId);
      } catch (error) {
        logger.error('Failed to delete subcategory image from S3:', error);
        // Continue with subcategory deletion
      }
    }
    
    await prisma.subcategory.delete({
      where: { id: subcategoryId }
    });
    
    logger.info(`Subcategory deleted: ${subcategoryId}`);
  }
  
  // Toggle subcategory status
  async toggleSubcategoryStatus(subcategoryId, isActive) {
    const subcategory = await prisma.subcategory.findUnique({
      where: { id: subcategoryId }
    });
    
    if (!subcategory) {
      throw new Error('Subcategory not found');
    }
    
    const activeStatus = isActive === true || isActive === 'true';
    
    const updatedSubcategory = await prisma.subcategory.update({
      where: { id: subcategoryId },
      data: {
        isActive: activeStatus,
        updatedAt: new Date()
      },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    logger.info(`Subcategory status updated: ${subcategoryId} -> ${activeStatus ? 'active' : 'inactive'}`);
    return updatedSubcategory;
  }
}

export default new SubcategoryService();