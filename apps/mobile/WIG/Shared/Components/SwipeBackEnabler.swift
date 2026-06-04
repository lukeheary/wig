import SwiftUI
import UIKit

struct SwipeBackEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        Controller()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        controller.enableInteractivePopWhenReady()
    }

    private final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            enableInteractivePopWhenReady()
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

