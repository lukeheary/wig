import SwiftUI
import UIKit

struct SwipeBackEnabler: UIViewControllerRepresentable {
    var onInteractivePopGestureStateChange: ((UIGestureRecognizer.State, Bool) -> Void)? = nil

    func makeUIViewController(context: Context) -> UIViewController {
        Controller()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        (controller as? Controller)?.onInteractivePopGestureStateChange = onInteractivePopGestureStateChange
        controller.enableInteractivePopWhenReady()
    }

    private final class Controller: UIViewController {
        var onInteractivePopGestureStateChange: ((UIGestureRecognizer.State, Bool) -> Void)?
        private weak var observedGestureRecognizer: UIGestureRecognizer?
        private var isObservingActiveTransition = false

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            enableInteractivePopWhenReady()
            onInteractivePopGestureStateChange?(.cancelled, true)
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            observeInteractivePopGestureIfNeeded()
        }

        private func observeInteractivePopGestureIfNeeded() {
            guard let gestureRecognizer = navigationController?.interactivePopGestureRecognizer,
                  observedGestureRecognizer !== gestureRecognizer
            else {
                return
            }

            observedGestureRecognizer?.removeTarget(self, action: #selector(handleInteractivePopGesture(_:)))
            gestureRecognizer.addTarget(self, action: #selector(handleInteractivePopGesture(_:)))
            observedGestureRecognizer = gestureRecognizer
        }

        @objc private func handleInteractivePopGesture(_ gestureRecognizer: UIGestureRecognizer) {
            let state = gestureRecognizer.state
            onInteractivePopGestureStateChange?(state, isTopViewController)

            if state == .began {
                observeActiveTransitionIfNeeded()
            }

            if state == .ended || state == .cancelled || state == .failed {
                DispatchQueue.main.async { [weak self] in
                    guard let self else {
                        return
                    }

                    self.onInteractivePopGestureStateChange?(state, self.isTopViewController)
                }
            }
        }

        private var isTopViewController: Bool {
            navigationController?.topViewController === self
        }

        private func observeActiveTransitionIfNeeded() {
            guard !isObservingActiveTransition,
                  let transitionCoordinator = navigationController?.transitionCoordinator
            else {
                return
            }

            isObservingActiveTransition = true
            transitionCoordinator.notifyWhenInteractionChanges { [weak self] context in
                DispatchQueue.main.async {
                    guard let self else {
                        return
                    }

                    self.isObservingActiveTransition = false
                    self.onInteractivePopGestureStateChange?(
                        context.isCancelled ? .cancelled : .ended,
                        self.isTopViewController
                    )
                }
            }
        }
    }
}

private extension UIViewController {
    func enableInteractivePopWhenReady() {
        DispatchQueue.main.async {
            guard let navigationController = self.navigationController else {
                return
            }

            navigationController.interactivePopGestureRecognizer?.isEnabled = true
            navigationController.interactivePopGestureRecognizer?.delegate = nil
        }
    }
}
