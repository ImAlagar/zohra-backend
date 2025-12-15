import { ratingService } from '../services/index.js';
import { asyncHandler } from '../utils/helpers.js';

// Get all ratings (Admin only)
export const getAllRatings = asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    isApproved, 
    productId, 
    userId, 
    variantId,
    includeVariantImages = 'true'  // New parameter
  } = req.query;
  
  const result = await ratingService.getAllRatings({
    page: parseInt(page),
    limit: parseInt(limit),
    isApproved,
    productId,
    userId,
    variantId,
    includeVariantImages: includeVariantImages === 'true'  // Parse boolean
  });
  
  res.status(200).json({
    success: true,
    data: result
  });
});


// Get rating by ID
export const getRatingById = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  
  const rating = await ratingService.getRatingById(ratingId);
  
  res.status(200).json({
    success: true,
    data: rating
  });
});

// Create rating (Authenticated users)
// In your ratingController.js
export const createRating = asyncHandler(async (req, res) => {
  const userId = req.user.id; // Assuming you have user in request
  
  const { productId, variantId, rating, title, review } = req.body;
  
  const newRating = await ratingService.createRating({
    productId,
    variantId, // Pass variantId
    rating,
    title,
    review
  }, userId);
  
  res.status(201).json({
    success: true,
    message: 'Rating submitted successfully',
    data: newRating
  });
});

export const updateRating = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { rating, title, review, variantId } = req.body;
  
  const updatedRating = await ratingService.updateRating(id, {
    rating,
    title,
    review,
    variantId // Pass variantId for update
  }, userId);
  
  res.status(200).json({
    success: true,
    message: 'Rating updated successfully',
    data: updatedRating
  });
});


// Delete rating (User can delete their own rating, Admin can delete any)
export const deleteRating = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  
  await ratingService.deleteRating(ratingId, userId, userRole);
  
  res.status(200).json({
    success: true,
    message: 'Rating deleted successfully'
  });
});

// Toggle rating approval status (Admin only)
export const toggleRatingApproval = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  const { isApproved } = req.body;
  
  const updatedRating = await ratingService.toggleRatingApproval(ratingId, isApproved);
  
  res.status(200).json({
    success: true,
    message: `Rating ${isApproved ? 'approved' : 'unapproved'} successfully`,
    data: updatedRating
  });
});

// Get rating statistics (Admin only)
export const getRatingStats = asyncHandler(async (req, res) => {
  const stats = await ratingService.getRatingStats();
  
  res.status(200).json({
    success: true,
    data: stats
  });
});

// Get product ratings (Public)
export const getProductRatings = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { page = 1, limit = 10, onlyApproved = true } = req.query;
  
  const result = await ratingService.getProductRatings(productId, {
    page: parseInt(page),
    limit: parseInt(limit),
    onlyApproved: onlyApproved === 'true'
  });
  
  res.status(200).json({
    success: true,
    data: result
  });
});

// Get user's ratings
export const getUserRatings = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, isApproved } = req.query;
  const userId = req.user.id;
  
  const result = await ratingService.getUserRatings(userId, {
    page: parseInt(page),
    limit: parseInt(limit),
    isApproved
  });
  
  res.status(200).json({
    success: true,
    data: result
  });
});

// Bulk update rating approval status (Admin only)
export const bulkUpdateRatingApproval = asyncHandler(async (req, res) => {
  const { ratingIds, isApproved } = req.body;
  
  if (!ratingIds || !Array.isArray(ratingIds) || ratingIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Rating IDs array is required'
    });
  }
  
  if (isApproved === undefined) {
    return res.status(400).json({
      success: false,
      message: 'isApproved status is required'
    });
  }
  
  const result = await ratingService.bulkUpdateRatingApproval(ratingIds, isApproved);
  
  res.status(200).json({
    success: true,
    message: `${result.count} rating(s) approval status updated successfully`,
    data: result
  });
});


// Get helpful status for current user
export const getHelpfulStatus = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  const userId = req.user.id;
  
  const result = await ratingService.getHelpfulStatus(ratingId, userId);
  
  res.status(200).json({
    success: true,
    data: result
  });
});


export const markHelpful = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  const userId = req.user.id;
  
  const result = await ratingService.markHelpful(ratingId, userId);
  
  res.status(200).json({
    success: true,
    message: 'Thank you for your feedback!',
    data: result
  });
});


// Remove helpful vote
export const removeHelpful = asyncHandler(async (req, res) => {
  const { ratingId } = req.params;
  const userId = req.user.id;
  
  const result = await ratingService.removeHelpful(ratingId, userId);
  
  res.status(200).json({
    success: true,
    message: 'Helpful vote removed successfully',
    data: result
  });
});

