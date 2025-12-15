import express from 'express';
import {
  initiatePayment,
  handlePaymentCallback,
  checkPaymentStatus,
  getAllOrders,
  getOrderById,
  getOrderByOrderNumber,
  updateOrderStatus,
  updateTrackingInfo,
  processRefund,
  getUserOrders,
  getOrderStats,
  calculateOrderTotals,
  createCODOrder,
  testPhonePeIntegration,
  verifyPaymentAndCreateOrder,
  deleteOrder,
  softDeleteOrder,
  bulkDeleteOrders,
  restoreOrder
} from '../controllers/orderController.js';
import { auth, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/calculate-totals', calculateOrderTotals);

// PhonePe Payment Routes
router.post('/initiate-payment', auth, initiatePayment); // Creates Razorpay order
router.post('/verify-payment', auth, verifyPaymentAndCreateOrder); // Creates actual order after payment
router.post('/create-cod-order', auth, createCODOrder); // Creates COD order immediately

router.post('/payment-callback', handlePaymentCallback);
router.get('/payment-status/:merchantTransactionId', checkPaymentStatus);

// User Routes
router.get('/user/my-orders', auth, getUserOrders);
router.get('/order-number/:orderNumber', getOrderByOrderNumber);

// Admin Routes
router.get('/admin', auth, authorize('ADMIN'), getAllOrders);
router.get('/admin/stats', auth, authorize('ADMIN'), getOrderStats);
router.get('/admin/:orderId', auth, authorize('ADMIN'), getOrderById);
router.patch('/admin/:orderId/status', auth, authorize('ADMIN'), updateOrderStatus);
router.patch('/admin/:orderId/tracking', auth, authorize('ADMIN'), updateTrackingInfo);
router.post('/admin/:orderId/refund', auth, authorize('ADMIN'), processRefund);
// Add this route to orderRoutes.js after the other admin routes
router.delete('/admin/:orderId', auth, authorize('ADMIN'), deleteOrder);
router.delete('/admin/soft/:orderId', auth, authorize('ADMIN'), softDeleteOrder);
router.delete('/admin/bulk-delete', auth, authorize('ADMIN'), bulkDeleteOrders);
// Add this route as well
router.patch('/admin/restore/:orderId', auth, authorize('ADMIN'), restoreOrder);
// Add to routes
router.get('/test-phonepe-integration', testPhonePeIntegration);

export default router;