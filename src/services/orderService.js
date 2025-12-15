import prisma from '../config/database.js';
import emailNotificationService from './emailNotificationService.js';
import phonepeService from './phonepeService.js';
import logger from '../utils/logger.js';
import razorpayService from './razorpayService.js';

class OrderService {
  generateOrderNumber() {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  // Calculate quantity price for a single item
  async calculateItemQuantityPrice(productId, subcategoryId, basePrice, quantity) {
    // If no subcategory, return regular pricing
    if (!subcategoryId) {
      return {
        originalPrice: basePrice * quantity,
        finalPrice: basePrice * quantity,
        totalSavings: 0,
        pricePerItem: basePrice,
        hasDiscount: false
      };
    }

    // Get quantity prices for the subcategory
    const quantityPrices = await prisma.subcategoryQuantityPrice.findMany({
      where: { 
        subcategoryId: subcategoryId,
        isActive: true,
        quantity: { lte: quantity }
      },
      orderBy: { 
        quantity: 'desc'
      }
    });

    let bestTotal = basePrice * quantity;
    let appliedDiscount = null;

    // Find the best applicable discount
    for (const priceRule of quantityPrices) {
      if (quantity >= priceRule.quantity) {
        let finalPriceForRule = 0;

        if (priceRule.priceType === 'PERCENTAGE') {
          // Calculate percentage discount
          finalPriceForRule = (basePrice * quantity) * (1 - priceRule.value / 100);
        } else {
          // Fixed amount
          finalPriceForRule = priceRule.value;
        }

        // If this rule gives a better price, use it
        if (finalPriceForRule < bestTotal) {
          bestTotal = finalPriceForRule;
          appliedDiscount = {
            quantity: priceRule.quantity,
            priceType: priceRule.priceType,
            value: priceRule.value
          };
        }
      }
    }

    const totalSavings = (basePrice * quantity) - bestTotal;
    
    return {
      originalPrice: basePrice * quantity,
      finalPrice: bestTotal,
      totalSavings: totalSavings,
      pricePerItem: bestTotal / quantity,
      hasDiscount: appliedDiscount !== null,
      appliedDiscount
    };
  }

  // Enhanced order totals calculation with quantity pricing
  async calculateOrderTotals(orderItems, couponCode = null) {
    let subtotal = 0;
    let quantitySavings = 0;
    
    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      throw new Error('Order items are required and must be a non-empty array');
    }

    const itemsWithPricing = [];

    // Calculate subtotal with quantity pricing
    for (const item of orderItems) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        throw new Error('Invalid order item: productId and quantity are required');
      }

      // Get product details
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: {
          id: true,
          name: true,
          normalPrice: true,
          offerPrice: true,
          wholesalePrice: true,
          status: true,
          subcategoryId: true
        }
      });

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      if (product.status !== 'ACTIVE') {
        throw new Error(`Product ${product.id} is not available for purchase`);
      }

      // Check variant stock if provided
      let variant = null;
      if (item.productVariantId) {
        variant = await prisma.productVariant.findUnique({
          where: { id: item.productVariantId },
          select: { 
            stock: true
          }
        });

        if (!variant) {
          throw new Error(`Product variant not found: ${item.productVariantId}`);
        }

        if (variant.stock < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.productVariantId}. Available: ${variant.stock}, Requested: ${item.quantity}`);
        }
      }

      // Calculate price with quantity discounts
      const basePrice = product.offerPrice || product.normalPrice;
      const quantityPriceCalculation = await this.calculateItemQuantityPrice(
        product.id,
        product.subcategoryId,
        basePrice,
        item.quantity
      );

      const itemTotal = quantityPriceCalculation.finalPrice;
      const itemSavings = quantityPriceCalculation.totalSavings;

      subtotal += itemTotal;
      quantitySavings += itemSavings;

      itemsWithPricing.push({
        ...item,
        product,
        variant,
        basePrice,
        quantityPricing: quantityPriceCalculation,
        itemTotal,
        itemSavings
      });
    }

    // Calculate coupon discount
    let couponDiscount = 0;
    let coupon = null;
    
    if (couponCode) {
      coupon = await prisma.coupon.findFirst({
        where: {
          code: couponCode,
          isActive: true,
          validFrom: { lte: new Date() },
          validUntil: { gte: new Date() },
          OR: [
            { usageLimit: null },
            { usageLimit: { gt: prisma.coupon.fields.usedCount } }
          ]
        }
      });

      if (coupon) {
        if (subtotal >= (coupon.minOrderAmount || 0)) {
          if (coupon.discountType === 'PERCENTAGE') {
            couponDiscount = (subtotal * coupon.discountValue) / 100;
            if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
              couponDiscount = coupon.maxDiscount;
            }
          } else {
            couponDiscount = coupon.discountValue;
          }
        }
      }
    }

    // Free shipping for all orders
    const shippingCost = 0;
    const totalAmount = subtotal - couponDiscount + shippingCost;

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      quantitySavings: parseFloat(quantitySavings.toFixed(2)),
      couponDiscount: parseFloat(couponDiscount.toFixed(2)),
      shippingCost: parseFloat(shippingCost.toFixed(2)),
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      coupon,
      items: itemsWithPricing,
      hasQuantityDiscounts: quantitySavings > 0
    };
  }

  async initiateRazorpayPayment(orderData) {
    const {
      userId,
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      orderItems,
      couponCode,
      customImages = []
    } = orderData;

    // Validate required fields
    if (!name || !email || !phone || !address || !city || !state || !pincode) {
      throw new Error('All shipping information fields are required');
    }

    // Calculate totals with quantity pricing
    const totals = await this.calculateOrderTotals(orderItems, couponCode);

    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder(
      totals.totalAmount,
      'INR'
    );

    // Store temporary order data
    const tempOrderData = {
      userId,
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      orderItems,
      couponCode,
      customImages,
      totals,
      razorpayOrderId: razorpayOrder.id
    };

    logger.info(`Razorpay order initiated with quantity discounts. Savings: ₹${totals.quantitySavings}`);

    return {
      razorpayOrder,
      tempOrderData: {
        ...tempOrderData,
        orderNumber: this.generateOrderNumber()
      }
    };
  }

  async verifyAndCreateOrder(paymentData) {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderData
    } = paymentData;

    // Verify payment signature
    const isValid = razorpayService.verifyPayment(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      throw new Error('Payment verification failed');
    }

    // Calculate totals again to ensure consistency
    const totals = await this.calculateOrderTotals(orderData.orderItems, orderData.couponCode);

    // Prepare custom images data
    const customImages = orderData.customImages || [];

    // Prepare order data - FIXED: Use coupon relation instead of couponId
    const orderCreateData = {
      orderNumber: this.generateOrderNumber(),
      user: {
        connect: {
          id: orderData.userId
        }
      },
      name: orderData.name,
      email: orderData.email,
      phone: orderData.phone,
      address: orderData.address,
      city: orderData.city,
      state: orderData.state,
      pincode: orderData.pincode,
      status: 'CONFIRMED',
      totalAmount: totals.totalAmount,
      subtotal: totals.subtotal,
      discount: totals.couponDiscount,
      shippingCost: totals.shippingCost,
      paymentStatus: 'PAID',
      paymentMethod: 'ONLINE',
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      // FIXED: Use coupon relation instead of couponId
      ...(totals.coupon && {
        coupon: {
          connect: {
            id: totals.coupon.id
          }
        }
      }),
      // Create custom image records if any
      ...(customImages.length > 0 && {
        customImages: {
          create: customImages.map(img => ({
            imageUrl: img.url,
            imageKey: img.key,
            filename: img.filename || `custom-image-${Date.now()}.jpg`
          }))
        }
      }),
      orderItems: {
        create: await Promise.all(
          totals.items.map(async (item) => {
            return {
              productId: item.productId,
              productVariantId: item.productVariantId || null,
              quantity: item.quantity,
              price: item.basePrice,
            };
          })
        )
      }
    };

    // Create the actual order in database
    const order = await prisma.order.create({
      data: orderCreateData,
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
        productVariant: {
          include: {
            variantImages: {  // Add this
              select: {
                imageUrl: true,
                color: true
              }
            }
          }
        }

          }
        },
        customImages: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        coupon: true
      }
    });

    // Update stock for variants
    for (const item of orderData.orderItems) {
      if (item.productVariantId) {
        await prisma.productVariant.update({
          where: { id: item.productVariantId },
          data: {
            stock: { decrement: item.quantity }
          }
        });
      }
    }

    // Increment coupon usage
    if (totals.coupon) {
      await prisma.coupon.update({
        where: { id: totals.coupon.id },
        data: {
          usedCount: { increment: 1 }
        }
      });
    }

    // Create tracking history
    await prisma.trackingHistory.create({
      data: {
        orderId: order.id,
        status: 'CONFIRMED',
        description: `Order confirmed and payment received. Quantity savings: ₹${totals.quantitySavings}`,
        location: `${order.city}, ${order.state}`
      }
    });

    // Send email notification with quantity discount details
    try {
      await emailNotificationService.sendOrderNotifications(order);
    } catch (emailError) {
      logger.error('Failed to send order confirmation email:', emailError);
    }

    logger.info(`Order created successfully with quantity discounts. Total savings: ₹${totals.quantitySavings}`);
    
    // Return order with quantity discount info
    return {
      ...order,
      quantitySavings: totals.quantitySavings,
      hasQuantityDiscounts: totals.hasQuantityDiscounts
    };
  }

  async createCODOrder(orderData) {
    const {
      userId,
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      orderItems,
      couponCode,
      customImages = []
    } = orderData;

    // Validate required fields
    if (!name || !email || !phone || !address || !city || !state || !pincode) {
      throw new Error('All shipping information fields are required');
    }

    // Calculate totals with quantity pricing
    const totals = await this.calculateOrderTotals(orderItems, couponCode);

    // Prepare order data - FIXED: Use coupon relation instead of couponId
    const orderCreateData = {
      orderNumber: this.generateOrderNumber(),
      user: {
        connect: {
          id: userId
        }
      },
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      status: 'CONFIRMED',
      totalAmount: totals.totalAmount,
      subtotal: totals.subtotal,
      discount: totals.couponDiscount,
      shippingCost: totals.shippingCost,
      paymentStatus: 'PENDING',
      paymentMethod: 'COD',
      // FIXED: Use coupon relation instead of couponId
      ...(totals.coupon && {
        coupon: {
          connect: {
            id: totals.coupon.id
          }
        }
      }),
      // Create custom image records if any
      ...(customImages.length > 0 && {
        customImages: {
          create: customImages.map(img => ({
            imageUrl: img.url,
            imageKey: img.key,
            filename: img.filename || `custom-image-${Date.now()}.jpg`
          }))
        }
      }),
      orderItems: {
        create: await Promise.all(
          totals.items.map(async (item) => {
            return {
              productId: item.productId,
              productVariantId: item.productVariantId || null,
              quantity: item.quantity,
              price: item.basePrice,
            };
          })
        )
      }
    };

    // Create order with COD status
    const order = await prisma.order.create({
      data: orderCreateData,
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: {
              include: {
                variantImages: {
                  take: 1,
                  select: {
                    imageUrl: true,
                    color: true
                  }
                }
              }
            }
          }
        },
        customImages: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        coupon: true
      }
    });

    // Update stock for variants
    for (const item of orderItems) {
      if (item.productVariantId) {
        await prisma.productVariant.update({
          where: { id: item.productVariantId },
          data: {
            stock: { decrement: item.quantity }
          }
        });
      }
    }

    // Increment coupon usage
    if (totals.coupon) {
      await prisma.coupon.update({
        where: { id: totals.coupon.id },
        data: {
          usedCount: { increment: 1 }
        }
      });
    }

    // Create tracking history
    await prisma.trackingHistory.create({
      data: {
        orderId: order.id,
        status: 'CONFIRMED',
        description: `COD order confirmed. Quantity savings: ₹${totals.quantitySavings}`,
        location: `${order.city}, ${order.state}`
      }
    });

    // Send email notification
    try {
      await emailNotificationService.sendOrderNotifications(order);
    } catch (emailError) {
      logger.error('Failed to send COD order confirmation email:', emailError);
    }

    logger.info(`COD order created successfully with quantity discounts. Savings: ₹${totals.quantitySavings}`);
    
    // Return order with quantity discount info
    return {
      ...order,
      quantitySavings: totals.quantitySavings,
      hasQuantityDiscounts: totals.hasQuantityDiscounts
    };
  }


  async getAllOrders({ page, limit, status, userId, paymentStatus }) {
    const skip = (page - 1) * limit;
    
    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (userId) {
      where.userId = userId;
    }
    
    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }
    
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: {
            include: {
              product: {
                include: {
                  images: {
                    take: 1,
                    select: {
                      imageUrl: true
                    }
                  }
                }
              },
              productVariant: {
                include: {
                  variantImages: {
                    take: 1,
                    select: {
                      imageUrl: true,
                      color: true
                    }
                  }
                }
              }
            }
          },
          customImages: true, // Include custom images
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          coupon: true,
          trackingHistory: {
            take: 5,
            orderBy: {
              createdAt: 'desc'
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.order.count({ where })
    ]);
    
    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getOrderById(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
              productVariant: {
                include: {
                  variantImages: {
                    take: 1,
                    select: {
                      imageUrl: true,
                      color: true
                    }
                  }
                }
              }
          }
        },
        customImages: {
          select: {
            imageUrl: true,
            imageKey: true,
            filename: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        coupon: true,
        trackingHistory: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    return order;
  }

  async getOrderByOrderNumber(orderNumber) {
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: {
              select: {
                id: true,
                color: true,
                size: true
              }
            }
          }
        },
        customImages: true, // Include custom images
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        coupon: true,
        trackingHistory: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    return order;
  }

  async updateOrderStatus(orderId, statusData) {
    const { status, adminNotes } = statusData;
    
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    const validStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid status');
    }
    
    const oldStatus = order.status;
    
    const updateData = {
      status,
      ...(adminNotes && { adminNotes })
    };

    // Set timestamps for specific status changes
    if (status === 'SHIPPED' && order.status !== 'SHIPPED') {
      updateData.shippedAt = new Date();
    }
    
    if (status === 'DELIVERED' && order.status !== 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: {
              select: {
                id: true,
                color: true,
                size: true
              }
            }
          }
        },
        customImages: true, // Include custom images
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    

    if (status !== order.status) {
      await prisma.trackingHistory.create({
        data: {
          orderId,
          status,
          description: this.getStatusDescription(status),
          location: `${order.city}, ${order.state}`
        }
      });

      try {
        await emailNotificationService.sendOrderStatusUpdate(updatedOrder, oldStatus, status);
      } catch (emailError) {
        logger.error('Failed to send status update email:', emailError);
      }
    }
    
    logger.info(`Order status updated: ${orderId} -> ${status}`);
    return updatedOrder;
  }

  async updateTrackingInfo(orderId, trackingData) {
    const { trackingNumber, carrier, trackingUrl, estimatedDelivery } = trackingData;
    
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber,
        carrier,
        trackingUrl,
        estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
        status: 'SHIPPED',
        shippedAt: new Date()
      },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: {
              select: {
                id: true,
                color: true,
                size: true
              }
            }
          }
        },
        customImages: true, // Include custom images
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    await prisma.trackingHistory.create({
      data: {
        orderId,
        status: 'SHIPPED',
        description: `Order shipped via ${carrier}. Tracking number: ${trackingNumber}`,
        location: `${order.city}, ${order.state}`
      }
    });

    try {
      await emailNotificationService.sendOrderStatusUpdate(updatedOrder, order.status, 'SHIPPED');
    } catch (emailError) {
      logger.error('Failed to send shipping notification email:', emailError);
    }
    
    logger.info(`Tracking info updated for order: ${orderId}`);
    return updatedOrder;
  }

  async processRefund(orderId, refundData) {
    const { refundAmount, reason, adminNotes } = refundData;
    
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: true
          }
        },
        customImages: true // Include custom images
      }
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.paymentStatus !== 'PAID') {
      throw new Error('Cannot refund order that is not paid');
    }
    
    if (order.status === 'REFUNDED') {
      throw new Error('Order is already refunded');
    }

    if (!order.phonepeTransactionId) {
      throw new Error('Original transaction ID not found for refund');
    }
    
    let phonepeRefundId = null;
    try {
      const refundResponse = await phonepeService.processRefund(
        order.phonepeTransactionId,
        refundAmount || order.totalAmount,
        `REFUND_${order.id}`
      );
      
      if (refundResponse.success) {
        phonepeRefundId = refundResponse.data.merchantRefundId;
      } else {
        throw new Error(refundResponse.message || 'Refund failed');
      }
    } catch (phonepeError) {
      logger.error('PhonePe refund failed:', phonepeError);
      throw new Error('Refund processing failed: ' + phonepeError.message);
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'REFUNDED',
        paymentStatus: 'REFUNDED',
        ...(adminNotes && { adminNotes })
      },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            },
            productVariant: {
              select: {
                id: true,
                color: true,
                size: true
              }
            }
          }
        },
        customImages: true, // Include custom images
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    await prisma.trackingHistory.create({
      data: {
        orderId,
        status: 'REFUNDED',
        description: `Order refunded. Amount: ₹${refundAmount || order.totalAmount}. Reason: ${reason}. Refund ID: ${phonepeRefundId}`,
        location: 'System'
      }
    });
    
    // Restore stock for refunded items
    for (const item of order.orderItems) {
      if (item.productVariantId) {
        await prisma.productVariant.update({
          where: { id: item.productVariantId },
          data: {
            stock: { increment: item.quantity }
          }
        });
      }
    }

    try {
      await emailNotificationService.sendOrderRefundNotification(updatedOrder, {
        refundAmount: refundAmount || order.totalAmount,
        reason,
        phonepeRefundId
      });
    } catch (emailError) {
      logger.error('Failed to send refund notification email:', emailError);
    }
    
    logger.info(`Order refunded: ${orderId}, PhonePe Refund ID: ${phonepeRefundId}`);
    return {
      ...updatedOrder,
      phonepeRefundId,
      refundAmount: refundAmount || order.totalAmount
    };
  }

  async getUserOrders(userId, { page, limit, status }) {
    const skip = (page - 1) * limit;
    
    const where = { userId };
    
    if (status) {
      where.status = status;
    }
    
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: {
            include: {
              product: {
                include: {
                  images: {
                    take: 1,
                    select: {
                      imageUrl: true
                    }
                  }
                }
              },
              productVariant: {
                include: {
                  variantImages: {
                    take: 1,
                    select: {
                      imageUrl: true,
                      color: true
                    }
                  }
                }
              }
            }
          },
          customImages: true, // Include custom images
          trackingHistory: {
            take: 3,
            orderBy: {
              createdAt: 'desc'
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.order.count({ where })
    ]);
    
    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getOrderStats() {
    const [
      totalOrders,
      pendingOrders,
      confirmedOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      refundedOrders,
      totalRevenue,
      todayOrders,
      monthlyRevenue
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({ where: { status: 'CONFIRMED' } }),
      prisma.order.count({ where: { status: 'PROCESSING' } }),
      prisma.order.count({ where: { status: 'SHIPPED' } }),
      prisma.order.count({ where: { status: 'DELIVERED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
      prisma.order.count({ where: { status: 'REFUNDED' } }),
      prisma.order.aggregate({
        _sum: {
          totalAmount: true
        },
        where: {
          status: { not: 'CANCELLED' },
          paymentStatus: 'PAID'
        }
      }),
      prisma.order.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.order.aggregate({
        _sum: {
          totalAmount: true
        },
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          },
          status: { not: 'CANCELLED' },
          paymentStatus: 'PAID'
        }
      })
    ]);
    
    return {
      totalOrders,
      statusBreakdown: {
        PENDING: pendingOrders,
        CONFIRMED: confirmedOrders,
        PROCESSING: processingOrders,
        SHIPPED: shippedOrders,
        DELIVERED: deliveredOrders,
        CANCELLED: cancelledOrders,
        REFUNDED: refundedOrders
      },
      revenue: {
        total: totalRevenue._sum.totalAmount || 0,
        monthly: monthlyRevenue._sum.totalAmount || 0
      },
      todayOrders
    };
  }

  async checkPaymentStatus(merchantTransactionId) {
    try {
      const order = await prisma.order.findFirst({
        where: { phonepeMerchantTransactionId: merchantTransactionId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          phonepeResponseCode: true,
          phonepeResponseMessage: true,
          totalAmount: true
        }
      });
      
      if (!order) {
        throw new Error('Order not found for the given transaction ID');
      }

      // If payment is already successful, return order status
      if (order.paymentStatus === 'PAID') {
        return order;
      }

      // Check with PhonePe for latest status
      const phonepeStatus = await phonepeService.checkPaymentStatus(merchantTransactionId);
      
      if (phonepeStatus.success && phonepeStatus.code === 'PAYMENT_SUCCESS' && order.paymentStatus !== 'PAID') {
        // Update order status if payment was successful
        await this.handlePhonePeCallback({
          merchantTransactionId,
          transactionId: phonepeStatus.data.transactionId,
          code: phonepeStatus.code,
          message: phonepeStatus.message,
          paymentInstrument: phonepeStatus.data.paymentInstrument
        });

        // Fetch updated order
        const updatedOrder = await prisma.order.findFirst({
          where: { phonepeMerchantTransactionId: merchantTransactionId },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            phonepeResponseCode: true,
            phonepeResponseMessage: true,
            totalAmount: true
          }
        });

        return updatedOrder;
      }

      return order;
    } catch (error) {
      logger.error('Error checking payment status:', error);
      throw error;
    }
  }

  getStatusDescription(status) {
    const descriptions = {
      PENDING: 'Order has been placed and is awaiting confirmation',
      CONFIRMED: 'Order has been confirmed and is being processed',
      PROCESSING: 'Order is being prepared for shipment',
      SHIPPED: 'Order has been shipped',
      DELIVERED: 'Order has been delivered successfully',
      CANCELLED: 'Order has been cancelled',
      REFUNDED: 'Order has been refunded'
    };
    return descriptions[status] || 'Order status updated';
  }

  // Utility method to cancel expired pending orders
  async cancelExpiredPendingOrders() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const expiredOrders = await prisma.order.findMany({
      where: {
        status: 'PENDING',
        paymentStatus: 'PENDING',
        createdAt: { lt: twentyFourHoursAgo }
      },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                images: {
                  take: 1,
                  select: {
                    imageUrl: true
                  }
                }
              }
            }
          }
        },
        customImages: true // Include custom images
      }
    });

    for (const order of expiredOrders) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'FAILED',
          phonepeResponseMessage: 'Payment not completed within 24 hours'
        }
      });

      await prisma.trackingHistory.create({
        data: {
          orderId: order.id,
          status: 'CANCELLED',
          description: 'Order automatically cancelled due to incomplete payment within 24 hours',
          location: 'System'
        }
      });

      logger.info(`Auto-cancelled expired order: ${order.orderNumber}`);
    }

    return {
      cancelledCount: expiredOrders.length,
      cancelledOrders: expiredOrders.map(order => order.orderNumber)
    };
  }

  // Add these methods to the OrderService class

async deleteOrder(orderId) {
  // First, check if order exists
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      customImages: true,
      trackingHistory: true
    }
  });
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  // Prevent deletion of orders that are not in terminal states
  const nonDeletableStatuses = ['PROCESSING', 'SHIPPED', 'DELIVERED'];
  if (nonDeletableStatuses.includes(order.status)) {
    throw new Error(`Cannot delete order with status: ${order.status}. Please cancel or refund first.`);
  }
  
  // Store order info for logging before deletion
  const orderInfo = {
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    status: order.status
  };
  
  try {
    // Delete related records first (in correct order due to foreign key constraints)
    
    // Delete tracking history
    if (order.trackingHistory && order.trackingHistory.length > 0) {
      await prisma.trackingHistory.deleteMany({
        where: { orderId }
      });
    }
    
    // Delete custom images
    if (order.customImages && order.customImages.length > 0) {
      await prisma.customOrderImage.deleteMany({
        where: { orderId }
      });
    }
    
    // Delete order items
    if (order.orderItems && order.orderItems.length > 0) {
      await prisma.orderItem.deleteMany({
        where: { orderId }
      });
    }
    
    // Delete the order itself
    await prisma.order.delete({
      where: { id: orderId }
    });
    
    logger.info(`Order permanently deleted: ${JSON.stringify(orderInfo)}`);
    
    return {
      deletedOrder: orderInfo,
      deletedAt: new Date(),
      message: 'Order permanently deleted'
    };
  } catch (error) {
    logger.error(`Failed to delete order ${orderId}:`, error);
    throw new Error(`Failed to delete order: ${error.message}`);
  }
}

async softDeleteOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId }
  });
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  // Check if already deleted
  if (order.deletedAt) {
    throw new Error('Order is already soft deleted');
  }
  
  // Update order with deleted flag and timestamp
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      deletedAt: new Date(),
      status: 'CANCELLED', // Optionally update status to cancelled
      // Add a note about soft deletion
      notes: JSON.stringify({
        ...JSON.parse(order.notes || '{}'),
        softDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: 'ADMIN' // In production, you'd pass the admin user ID
      })
    },
    include: {
      orderItems: {
        include: {
          product: {
            include: {
              images: {
                take: 1,
                select: {
                  imageUrl: true
                }
              }
            }
          },
          productVariant: {
            select: {
              id: true,
              color: true,
              size: true
            }
          }
        }
      },
      customImages: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });
  
  // Create tracking history entry
  await prisma.trackingHistory.create({
    data: {
      orderId,
      status: 'CANCELLED',
      description: 'Order soft deleted by admin',
      location: 'System'
    }
  });
  
  logger.info(`Order soft deleted: ${order.orderNumber} (ID: ${orderId})`);
  
  return updatedOrder;
}

async bulkDeleteOrders(orderIds, deleteType = 'soft') {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new Error('No order IDs provided');
  }
  
  // Validate all orders exist and can be deleted
  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds }
    },
    select: {
      id: true,
      orderNumber: true,
      status: true
    }
  });
  
  if (orders.length !== orderIds.length) {
    // Find which IDs are invalid
    const foundIds = orders.map(order => order.id);
    const invalidIds = orderIds.filter(id => !foundIds.includes(id));
    throw new Error(`Some orders not found: ${invalidIds.join(', ')}`);
  }
  
  // Check for non-deletable orders
  const nonDeletableStatuses = ['PROCESSING', 'SHIPPED', 'DELIVERED'];
  const nonDeletableOrders = orders.filter(order => 
    deleteType === 'hard' && nonDeletableStatuses.includes(order.status)
  );
  
  if (nonDeletableOrders.length > 0) {
    throw new Error(
      `Cannot permanently delete orders in status: ${nonDeletableStatuses.join(', ')}. ` +
      `Affected orders: ${nonDeletableOrders.map(o => o.orderNumber).join(', ')}`
    );
  }
  
  let results = [];
  
  if (deleteType === 'soft') {
    // Soft delete all orders
    await prisma.order.updateMany({
      where: {
        id: { in: orderIds }
      },
      data: {
        deletedAt: new Date(),
        notes: JSON.stringify({
          softDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: 'ADMIN'
        })
      }
    });
    
    // Create tracking history for each order
    const trackingPromises = orderIds.map(orderId => 
      prisma.trackingHistory.create({
        data: {
          orderId,
          status: 'CANCELLED',
          description: 'Order soft deleted by admin (bulk operation)',
          location: 'System'
        }
      })
    );
    
    await Promise.all(trackingPromises);
    
    results = orders.map(order => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: 'SOFT_DELETED'
    }));
    
    logger.info(`Bulk soft deleted ${orders.length} orders`);
  } else {
    // Hard delete all orders and their dependencies
    for (const orderId of orderIds) {
      try {
        // Delete related records
        await prisma.trackingHistory.deleteMany({
          where: { orderId }
        });
        
        await prisma.customOrderImage.deleteMany({
          where: { orderId }
        });
        
        await prisma.orderItem.deleteMany({
          where: { orderId }
        });
        
        // Delete the order
        await prisma.order.delete({
          where: { id: orderId }
        });
        
        results.push({
          orderId,
          status: 'PERMANENTLY_DELETED',
          success: true
        });
      } catch (error) {
        results.push({
          orderId,
          status: 'FAILED',
          error: error.message,
          success: false
        });
      }
    }
    
    logger.info(`Bulk hard deleted ${orderIds.length} orders`);
  }
  
  return {
    deletedCount: results.filter(r => r.success !== false).length,
    failedCount: results.filter(r => r.success === false).length,
    results
  };
}

async restoreOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId }
  });
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  if (!order.deletedAt) {
    throw new Error('Order is not soft deleted');
  }
  
  // Parse existing notes
  const notes = JSON.parse(order.notes || '{}');
  
  // Remove soft delete info from notes
  delete notes.softDeleted;
  delete notes.deletedAt;
  delete notes.deletedBy;
  
  const restoredOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      deletedAt: null,
      notes: JSON.stringify(notes)
    },
    include: {
      orderItems: {
        include: {
          product: {
            include: {
              images: {
                take: 1,
                select: {
                  imageUrl: true
                }
              }
            }
          },
          productVariant: {
            select: {
              id: true,
              color: true,
              size: true
            }
          }
        }
      },
      customImages: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });
  
  // Create tracking history entry
  await prisma.trackingHistory.create({
    data: {
      orderId,
      status: restoredOrder.status,
      description: 'Order restored by admin',
      location: 'System'
    }
  });
  
  logger.info(`Order restored: ${restoredOrder.orderNumber} (ID: ${orderId})`);
  
  return restoredOrder;
}

}

export default new OrderService();