package com.nexuscontrol.agent

import android.app.admin.DeviceAdminReceiver

/**
 * Récepteur d'administration classique, activé uniquement après confirmation Android.
 * Il ne confère pas le rôle Device Owner et ne bloque pas la désinstallation.
 */
class NexusDeviceAdminReceiver : DeviceAdminReceiver()
