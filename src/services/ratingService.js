import prisma from '../config/database.js';
import logger from '../utils/logger.js';

class RatingService {
  // Get all ratings with pagination and filtering
async getAllRatings({ page, limit, isApproved, productId, userId, variantId }) {
  const skip = (page - 1) * limit;
  
  const where = {};
  
  if (isApproved !== undefined) {
    where.isApproved = isApproved === 'true';
  }
  
  if (productId) {
    where.productId = productId;
  }
  
  if (userId) {
    where.userId = userId;
  }

  if (variantId) {
    where.variantId = variantId;
  }
  
  const [ratings, total] = await Promise.all([
    prisma.rating.findMany({
      where,
      skip,
      take: limit,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true,
            normalPrice: true,
            offerPrice: true,
            // Include product images as well
            images: {
              select: {
                id: true,
                imageUrl: true,
                imagePublicId: true,
                isPrimary: true
              },
              orderBy: {
                isPrimary: 'desc'
              }
            }
          }
        },
        variant: {
          include: {
            variantImages: {
              select: {
                id: true,
                imageUrl: true,
                imagePublicId: true,
                isPrimary: true,
                color: true
              },
              orderBy: {
                isPrimary: 'desc'
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        helpfuls: {
          select: {
            id: true,
            userId: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    }),
    prisma.rating.count({ where })
  ]);
  
  // Transform the data to include images from variant OR product
  const transformedRatings = ratings.map(rating => {
    // Try to get variant images first
    const variantImages = rating.variant?.variantImages || [];
    
    // If no variant images, use product images
    const productImages = rating.product.images || [];
    
    // Determine which images to use
    const displayImages = variantImages.length > 0 ? variantImages : productImages;
    const primaryImage = displayImages.find(img => img.isPrimary) || displayImages[0];
    
    return {
      ...rating,
      variantInfo: rating.variant ? {
        id: rating.variant.id,
        color: rating.variant.color,
        size: rating.variant.size,
        images: variantImages,
        primaryImage: primaryImage
      } : null,
      // Always include display images for the frontend
      displayImages,
      primaryDisplayImage: primaryImage,
      // Indicate whether this is a variant-specific rating or product rating
      isVariantSpecific: !!rating.variantId
    };
  });
  
  return {
    ratings: transformedRatings,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
}

  // Get rating by ID
  async getRatingById(ratingId) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true,
            normalPrice: true,
            offerPrice: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    return rating;
  }

  // Create rating
async createRating({ productId, variantId, userId, userName, userEmail, rating, title, review }) {
  const newRating = await prisma.rating.create({
    data: {
      productId,
      variantId, // Include variantId if provided
      userId,
      userName,
      userEmail,
      rating,
      title,
      review,
      isApproved: true // or based on your business logic
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          productCode: true,
          normalPrice: true,
          offerPrice: true,
          images: {
            select: {
              id: true,
              imageUrl: true,
              imagePublicId: true,
              isPrimary: true
            },
            orderBy: {
              isPrimary: 'desc'
            }
          }
        }
      },
      variant: {
        include: {
          variantImages: {
            select: {
              id: true,
              imageUrl: true,
              imagePublicId: true,
              isPrimary: true,
              color: true
            },
            orderBy: {
              isPrimary: 'desc'
            }
          }
        }
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Transform the response
  const variantImages = newRating.variant?.variantImages || [];
  const productImages = newRating.product.images || [];
  const displayImages = variantImages.length > 0 ? variantImages : productImages;
  const primaryImage = displayImages.find(img => img.isPrimary) || displayImages[0];

  return {
    ...newRating,
    displayImages,
    primaryDisplayImage: primaryImage,
    isVariantSpecific: !!variantId
  };
}

  // Update rating (User can update their own rating)
  async updateRating(ratingId, updateData, userId) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    // Check if user owns this rating or is admin
    if (rating.userId !== userId) {
      throw new Error('You can only update your own ratings');
    }
    
    const { rating: newRating, title, review } = updateData;
    
    // Validate rating range if provided
    if (newRating && (newRating < 1 || newRating > 5)) {
      throw new Error('Rating must be between 1 and 5');
    }
    
    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        ...(newRating && { rating: parseInt(newRating) }),
        ...(title !== undefined && { title }),
        ...(review !== undefined && { review }),
        updatedAt: new Date()
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    logger.info(`Rating updated: ${ratingId}`);
    return updatedRating;
  }

  // Delete rating (User can delete their own rating, Admin can delete any)
  async deleteRating(ratingId, userId, userRole) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    // Check if user owns this rating or is admin
    if (rating.userId !== userId && userRole !== 'ADMIN') {
      throw new Error('You can only delete your own ratings');
    }
    
    await prisma.rating.delete({
      where: { id: ratingId }
    });
    
    logger.info(`Rating deleted: ${ratingId}`);
  }

  // Toggle rating approval status (Admin only)
  async toggleRatingApproval(ratingId, isApproved) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    const approvalStatus = isApproved === true || isApproved === 'true';
    
    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        isApproved: approvalStatus,
        updatedAt: new Date()
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            productCode: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    logger.info(`Rating approval updated: ${ratingId} -> ${approvalStatus ? 'approved' : 'unapproved'}`);
    return updatedRating;
  }

  // Get rating statistics (Admin only)
  async getRatingStats() {
    const [
      totalRatings,
      approvedRatings,
      pendingRatings,
      averageRating,
      ratingsByProduct,
      ratingsByUser
    ] = await Promise.all([
      prisma.rating.count(),
      prisma.rating.count({ where: { isApproved: true } }),
      prisma.rating.count({ where: { isApproved: false } }),
      prisma.rating.aggregate({
        _avg: {
          rating: true
        },
        where: { isApproved: true }
      }),
      prisma.rating.groupBy({
        by: ['productId'],
        _count: {
          id: true
        },
        _avg: {
          rating: true
        },
        where: { isApproved: true }
      }),
      prisma.rating.groupBy({
        by: ['userId'],
        _count: {
          id: true
        },
        where: { isApproved: true }
      })
    ]);
    
    return {
      totalRatings,
      approvedRatings,
      pendingRatings,
      averageRating: averageRating._avg.rating || 0,
      ratingsByProduct,
      ratingsByUser
    };
  }

  // Get product ratings (Public)
  async getProductRatings(productId, { page, limit, onlyApproved = true }) {
    const skip = (page - 1) * limit;
    
    const where = {
      productId
    };
    
    if (onlyApproved) {
      where.isApproved = true;
    }
    
    const [ratings, total, average] = await Promise.all([
      prisma.rating.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.rating.count({ where }),
      prisma.rating.aggregate({
        _avg: {
          rating: true
        },
        where
      })
    ]);
    
    // Calculate rating distribution
    const ratingDistribution = await prisma.rating.groupBy({
      by: ['rating'],
      _count: {
        id: true
      },
      where
    });
    
    return {
      ratings,
      averageRating: average._avg.rating || 0,
      totalRatings: total,
      ratingDistribution,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Get user's ratings
  async getUserRatings(userId, { page, limit, isApproved }) {
    const skip = (page - 1) * limit;
    
    const where = { userId };
    
    if (isApproved !== undefined) {
      where.isApproved = isApproved === 'true';
    }
    
    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where,
        skip,
        take: limit,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              productCode: true,
              normalPrice: true,
              offerPrice: true,
              images: {
                take: 1,
                select: {
                  imageUrl: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.rating.count({ where })
    ]);
    
    return {
      ratings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

    async markHelpful(ratingId, userId) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    // Check if user has already marked this rating as helpful
    const existingHelpful = await prisma.helpfulRating.findFirst({
      where: {
        ratingId,
        userId
      }
    });
    
    if (existingHelpful) {
      throw new Error('You have already marked this rating as helpful');
    }
    
    // Create helpful entry
    await prisma.helpfulRating.create({
      data: {
        ratingId,
        userId
      }
    });
    
    // Update helpful count on the rating
    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        helpfulCount: {
          increment: 1
        },
        updatedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    logger.info(`Rating marked as helpful: ${ratingId} by user: ${userId}`);
    return updatedRating;
  }

  // Bulk update rating approval status (Admin only)
  async bulkUpdateRatingApproval(ratingIds, isApproved) {
    const approvalStatus = isApproved === true || isApproved === 'true';
    
    const result = await prisma.rating.updateMany({
      where: {
        id: {
          in: ratingIds
        }
      },
      data: {
        isApproved: approvalStatus,
        updatedAt: new Date()
      }
    });
    
    logger.info(`Bulk rating approval update: ${ratingIds.length} ratings -> ${approvalStatus ? 'approved' : 'unapproved'}`);
    return result;
  }

    // Remove helpful vote
  async removeHelpful(ratingId, userId) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId }
    });
    
    if (!rating) {
      throw new Error('Rating not found');
    }
    
    // Check if user has marked this rating as helpful
    const existingHelpful = await prisma.helpfulRating.findFirst({
      where: {
        ratingId,
        userId
      }
    });
    
    if (!existingHelpful) {
      throw new Error('You have not marked this rating as helpful');
    }
    
    // Delete helpful entry
    await prisma.helpfulRating.delete({
      where: {
        id: existingHelpful.id
      }
    });
    
    // Update helpful count on the rating (decrement)
    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        helpfulCount: {
          decrement: 1
        },
        updatedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        helpfuls: {
          where: {
            userId: userId
          },
          select: {
            id: true,
            userId: true,
            createdAt: true
          }
        }
      }
    });
    
    logger.info(`Helpful vote removed: ${ratingId} by user: ${userId}`);
    return updatedRating;
  }

  // Optional: Get helpful status for a user and rating
  async getHelpfulStatus(ratingId, userId) {
    const helpful = await prisma.helpfulRating.findFirst({
      where: {
        ratingId,
        userId
      },
      select: {
        id: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    return {
      hasMarkedHelpful: !!helpful,
      helpfulData: helpful
    };
  }

}

export default new RatingService();