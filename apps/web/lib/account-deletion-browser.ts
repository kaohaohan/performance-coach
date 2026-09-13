"use client";

import { Capacitor } from "@capacitor/core";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type AuthCredential,
  type User,
} from "firebase/auth";
import { apiFetch } from "./api";
import {
  clearAccountScopedLocalState,
  type AccountDeletionDeps,
  type FirebaseUserLike,
} from "./account-deletion";
import { getFirebaseAuth } from "./firebase";
import { nativeAppleDeletionMaterial } from "./native-apple-auth";
import { nativeGoogleCredential } from "./native-google-auth";

function asUserLike(user: User): FirebaseUserLike {
  return user;
}

export function createBrowserDeletionGateway(promptPassword: () => Promise<string | null>): AccountDeletionDeps {
  return {
    getCurrentUser: () => {
      const current = getFirebaseAuth().currentUser;
      return current ? asUserLike(current) : null;
    },
    isNativePlatform: () => Capacitor.isNativePlatform(),
    reauthenticateWithCredential: async (user, credential) => {
      const current = getFirebaseAuth().currentUser;
      if (!current || current.uid !== user.uid) {
        throw new Error("signed-in user changed");
      }
      const result = await reauthenticateWithCredential(current, credential as AuthCredential);
      return { user: { uid: result.user.uid } };
    },
    reauthenticateGoogle: async (user) => {
      const current = getFirebaseAuth().currentUser;
      if (!current || current.uid !== user.uid) {
        throw new Error("signed-in user changed");
      }
      if (Capacitor.isNativePlatform()) {
        const credential = await nativeGoogleCredential();
        const result = await reauthenticateWithCredential(current, credential);
        return { user: { uid: result.user.uid } };
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await reauthenticateWithPopup(current, provider);
      return { user: { uid: result.user.uid } };
    },
    appleDeletionMaterial: nativeAppleDeletionMaterial,
    emailAuthCredential: (email, password) => EmailAuthProvider.credential(email, password),
    promptPassword,
    deleteMe: async (idToken, body) => {
      await apiFetch(idToken, "/api/v1/me", {
        method: "DELETE",
        freshToken: true,
        ...(body !== undefined ? { body } : {}),
      });
    },
    signOut: async () => {
      await getFirebaseAuth().signOut();
    },
    clearAccountLocalState: clearAccountScopedLocalState,
  };
}
