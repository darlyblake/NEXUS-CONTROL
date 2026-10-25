package com.nexuscontrol.agent

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Service volontairement inactif : aucun geste ni clic n'est exécuté sans
 * protocole de session authentifié ajouté et validé par l'utilisateur.
 */
class RemoteAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
}
